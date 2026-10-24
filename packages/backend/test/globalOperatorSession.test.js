import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import axios from "axios";
import { readFile } from "node:fs/promises";
import { OperatorSessionClient } from "../../frontend/src/lib/operatorSessionClient.js";
import { createAuthMiddleware } from "../src/middleware/authMiddleware.js";
import { createAuthRouter } from "../src/routes/authRoutes.js";
import { sanitizeMetadata } from "../src/services/auditService.js";
import { createOperatorDatabase, rpcClient, USER_A, USER_B, AUTH_A, AUTH_B, AUTH_A2 } from "./support/operatorDatabase.js";

let db, server, base;
const audit = [];
const secretA = "a".repeat(64), secretB = "b".repeat(64);
const hash = (secret) => createHash("sha256").update(secret).digest("hex");
let unavailable = false;
const identity = { A: [USER_A, AUTH_A], B: [USER_B, AUTH_B], A2: [USER_A, AUTH_A2] };
const call = async (path, token = "A", secret = secretA, method = "POST", body) => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (secret !== null) headers["X-Session-Id"] = secret;
  if (path === "/api/auth/activity" && body === undefined) body = { activityRevision: 1, activityAt: new Date().toISOString() };
  const response = await fetch(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
const expire = () => db.exec(`update public.global_operator_session set created_at = clock_timestamp() - interval '20 minutes',
  last_active_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 minute' where slot_id = 1`);
const leaseRow = async () => (await db.query("select * from public.global_operator_session")).rows[0];
const loginCount = async () => (await db.query("select count(*)::int as count from public.audit_logs where action='LOGIN_SUCCESS'")).rows[0].count;
const recoverRpc = async () => {
  await db.exec("reset role");
  await db.exec(await readFile(new URL("../database/20261008_global_session_recovery.sql", import.meta.url), "utf8"));
};

before(async () => {
  db = await createOperatorDatabase();
  const localRpc = rpcClient(db);
  const client = {
    auth: {
      getUser: async (token) => ({ data: { user: identity[token] ? { id: identity[token][0], email: "operator@example.test" } : null },
        error: identity[token] ? null : { status: 401 } }),
      getClaims: async (token) => ({ data: { claims: {
        sub: identity[token]?.[0], session_id: identity[token]?.[1], exp: Date.now() / 1000 + 3600,
      } }, error: null }),
    },
    rpc: (...args) => unavailable ? Promise.resolve({ error: { message: "database unavailable" } }) : localRpc.rpc(...args),
  };
  const log = async (entry) => audit.push(entry);
  const auth = createAuthMiddleware({ client, audit: log });
  const app = express(); app.use(express.json());
  app.use("/api/auth", createAuthRouter({ auth, audit: log }));
  app.get("/protected", auth.requireAuth, (req, res) => res.json({ user: req.user.id }));
  app.get("/public", (_req, res) => res.json({ public: true }));
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (db) await db.close(); });
beforeEach(async () => {
  unavailable = false; audit.length = 0;
  await db.exec("update public.global_operator_session set user_id=null,auth_session_id=null,app_session_hash=null,created_at=null,last_active_at=null,expires_at=null,expiry_reported=false; delete from public.operator_session_admissions; delete from public.audit_logs;");
});

test("first login succeeds; other account and other auth session of same account are rejected", async () => {
  assert.equal((await call("/api/auth/session")).status, 200);
  for (const token of ["B", "A2"]) {
    const result = await call("/api/auth/session", token, secretB);
    assert.equal(result.status, 409); assert.equal(result.body.code, "GLOBAL_SESSION_BUSY");
    assert.equal(result.body.user, undefined);
  }
  assert.equal((await call("/protected", "A", secretA, "GET")).status, 200);
  assert.equal(await loginCount(), 1);
});

for (const competitor of ["B", "A2"]) test(`concurrent HTTP acquisitions (${competitor}) have one winner`, async () => {
  const results = await Promise.all([call("/api/auth/session"), call("/api/auth/session", competitor, secretB)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await db.query("select count(*)::int as count from public.operator_session_admissions")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int as count from public.global_operator_session")).rows[0].count, 1);
});

test("idempotent retry and restoration preserve expiry; status/protected polling never extends", async () => {
  await call("/api/auth/session"); const original = (await leaseRow()).expires_at;
  assert.equal((await call("/api/auth/session")).body.lease.created, false);
  assert.equal((await call("/api/auth/session-status", "A", secretA, "GET")).status, 200);
  assert.equal((await call("/protected", "A", secretA, "GET")).status, 200);
  assert.equal((await leaseRow()).expires_at.getTime(), original.getTime());
  assert.equal(await loginCount(), 1);
});

test("real activity extends; expired activity and registration cannot resurrect old session", async () => {
  await call("/api/auth/session");
  await db.exec("update public.global_operator_session set expires_at=expires_at - interval '1 minute'");
  const before = (await leaseRow()).expires_at;
  assert.equal((await call("/api/auth/activity")).status, 200);
  assert.ok((await leaseRow()).expires_at > before);
  await expire();
  for (const path of ["/api/auth/activity", "/api/auth/session"]) {
    assert.equal((await call(path)).body.code, "SESSION_TIMEOUT");
  }
});

test("closed browser lease expires and is replaced without cleanup; late calls cannot affect new owner", async () => {
  await call("/api/auth/session"); await expire();
  assert.equal((await call("/api/auth/session", "B", secretB)).status, 200);
  const before = await leaseRow();
  for (const path of ["/api/auth/logout", "/api/auth/activity", "/api/auth/logout-timeout"]) {
    assert.equal((await call(path)).body.code, "SESSION_MISMATCH");
  }
  assert.deepEqual(await leaseRow(), before);
});

test("manual and timeout logout release only the exact session; retired session cannot re-acquire", async () => {
  await call("/api/auth/session");
  assert.equal((await call("/api/auth/logout", "A", secretB)).status, 401);
  assert.equal((await call("/api/auth/logout")).body.released, true);
  assert.equal((await call("/api/auth/session")).body.code, "SESSION_TIMEOUT");
  assert.equal((await call("/api/auth/session", "B", secretB)).status, 200);
  assert.equal((await call("/api/auth/logout-timeout", "B", secretB)).body.code, "SESSION_STILL_ACTIVE");
  await expire();
  assert.equal((await call("/api/auth/logout-timeout", "B", secretB)).body.released, true);
  assert.equal((await leaseRow()).user_id, null);
});

for (const release of ["logout", "timeout"]) test(`same-account Device B acquires after Device A ${release}`, async () => {
  assert.equal((await call("/api/auth/session", "A", secretA)).status, 200);
  assert.equal((await call("/api/auth/session", "A2", secretB)).body.code, "GLOBAL_SESSION_BUSY");
  if (release === "timeout") await expire();
  const endpoint = release === "timeout" ? "/api/auth/logout-timeout" : "/api/auth/logout";
  assert.equal((await call(endpoint, "A", secretA)).body.released, true);
  assert.equal((await call("/api/auth/session", "A2", secretB)).status, 200);
  assert.equal((await leaseRow()).user_id, USER_A);
  assert.equal((await leaseRow()).auth_session_id, AUTH_A2);
  assert.equal((await call("/protected", "A", secretA, "GET")).body.code, "SESSION_MISMATCH");
  assert.equal((await call("/protected", "A2", secretB, "GET")).status, 200);
});

test("missing/fake app identity and other valid token are rejected", async () => {
  await call("/api/auth/session");
  assert.equal((await call("/protected", "A", null, "GET")).body.code, "MISSING_SESSION_ID");
  assert.equal((await call("/protected", "A", "fake", "GET")).body.code, "INVALID_SESSION");
  assert.equal((await call("/protected", "A2", secretA, "GET")).body.code, "SESSION_MISMATCH");
  assert.equal((await call("/protected", "bad-token", secretA, "GET")).body.code, "TOKEN_EXPIRED");
});

test("database failure has no fallback and no successful login audit; public access stays available", async () => {
  unavailable = true;
  assert.equal((await call("/api/auth/session")).body.code, "SESSION_DATABASE_UNAVAILABLE");
  assert.equal((await call("/protected", "A", secretA, "GET")).status, 503);
  assert.equal((await call("/public", "bad-token", null, "GET")).status, 200);
  assert.equal(await loginCount(), 0);
});

test("expired status audit is emitted once by PostgreSQL", async () => {
  await call("/api/auth/session"); await expire();
  await call("/api/auth/session-status", "A", secretA, "GET");
  await call("/api/auth/session-status", "A", secretA, "GET");
  const { rows } = await db.query("select count(*)::int as count from public.audit_logs where action='SESSION_EXPIRED'");
  assert.equal(rows[0].count, 1);
});

test("singleton constraint and direct session/RPC permissions prevent bypass", async () => {
  await assert.rejects(db.exec("insert into public.global_operator_session(slot_id) values (2)"));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select * from public.global_operator_session"));
      await assert.rejects(db.query("select public.operator_session_acquire($1,$2,$3)", [USER_A, AUTH_A, hash(secretA)]));
      await assert.rejects(db.query("select public.operator_session_check($1,$2,$3,'extend')", [USER_A, AUTH_A, hash(secretA)]));
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try {
    const { rows } = await db.query("select public.operator_session_acquire($1,$2,$3) as result", [USER_A, AUTH_A, hash(secretA)]);
    assert.equal(rows[0].result.code, "OK");
  } finally { await db.exec("reset role"); }
});

test("RLS preserves public reads and historical data but denies table and column operator writes", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      assert.equal((await db.query("select * from public.rainfall_readings")).rows[0].notes, "historical data");
      await assert.rejects(db.query("insert into public.rainfall_readings(id,rainfall_value) values (2,20)"));
      await assert.rejects(db.query("update public.rainfall_readings set notes='bypass' where id=1"));
      await assert.rejects(db.query("delete from public.rainfall_readings where id=1"));
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { await db.query("update public.rainfall_readings set rainfall_value=10 where id=1"); }
  finally { await db.exec("reset role"); }
  assert.equal((await db.query("select count(*)::int as count from public.rainfall_readings")).rows[0].count, 1);
});

test("audit sanitization removes nested tokens and session secrets", () => {
  const result = sanitizeMetadata({ password: "pw", access_token: "jwt", nested: {
    session_id: secretA, app_session_hash: hash(secretA), "X-Session-Id": secretA, code: "SESSION_INVALID",
  } });
  assert.deepEqual(result, { nested: { code: "SESSION_INVALID" } });
  assert.equal(JSON.stringify(audit).includes(secretA), false);
});

test("frontend lifecycle integrates with Express and real local SQL RPCs", async () => {
  const signouts = [];
  const makeClient = (token, secret) => {
    const session = { access_token: token, user: { id: identity[token][0] } };
    const stored = new Map();
    const options = {
      auth: { signInWithPassword: async () => ({ data: { session }, error: null }),
        getSession: async () => ({ data: { session }, error: null }),
        signOut: async (scope) => { signouts.push({ token, ...scope }); return {}; } },
      storage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
      api: axios.create({ baseURL: base, proxy: false, timeout: 5000 }), makeSecret: () => secret,
      withAuthLock: (action) => action(),
    };
    options.auth.setSession = async () => ({ data: { session }, error: null });
    options.createCandidate = () => ({ ...options.auth });
    return { client: new OperatorSessionClient(options), options };
  };
  const a = makeClient("A", secretA), b = makeClient("B", secretB);
  await a.client.login("a", "test-only");
  await assert.rejects(b.client.login("b", "test-only"), (error) => error.response.data.code === "GLOBAL_SESSION_BUSY");
  assert.equal(a.client.status, "authenticated");
  const refreshed = new OperatorSessionClient(a.options);
  await refreshed.restore();
  assert.equal(refreshed.status, "authenticated");
  assert.equal(await loginCount(), 1);
  refreshed.recordInteraction(false);
  assert.equal(await refreshed.flushActivity(true), true);
  assert.equal(await refreshed.logout(), true);
  await b.client.login("b", "test-only");
  assert.equal(b.client.status, "authenticated");
  assert.equal(await a.client.logout(), false);
  assert.equal((await leaseRow()).user_id, USER_B);
  assert.ok(signouts.every((entry) => entry.scope === "local"));
});

test("unknown audit vocabulary stops migration instead of removing custom authorization/audit rules", async () => {
  await assert.rejects(createOperatorDatabase({ beforeMigration: (database) => database.exec(`
    alter table public.audit_logs drop constraint audit_logs_action_check;
    alter table public.audit_logs add constraint audit_logs_action_check check (action in ('CUSTOM_ACTION'));
  `) }), /Unexpected audit action vocabulary/);
});

test("hardening migration stops on a callable definer RPC that bypasses rainfall permissions", async () => {
  await db.exec("create function public.unsafe_rainfall() returns void language sql security definer as 'delete from public.rainfall_readings';");
  try {
    const sql = await readFile(new URL("../database/20261008_02_operator_write_permissions.sql", import.meta.url), "utf8");
    await assert.rejects(db.exec(sql), /Callable rainfall\/application RPC.*manual chain review/);
    await db.exec("rollback");
  } finally { await db.exec("rollback; drop function public.unsafe_rainfall()"); }
  assert.equal((await db.query("select notes from public.rainfall_readings where id=1")).rows[0].notes, "historical data");
});

test("emergency rollback preserves readings and admissions and stops operator authorization safely", async () => {
  await call("/api/auth/session");
  const sql = await readFile(new URL("../database/20261008_global_session_rollback.sql", import.meta.url), "utf8");
  await db.exec(sql);
  try {
    assert.equal((await call("/protected", "A", secretA, "GET")).status, 503);
    assert.equal((await call("/public", "bad-token", null, "GET")).status, 200);
    await db.exec("set role service_role");
    await assert.rejects(db.query("select public.operator_session_acquire($1,$2,$3)", [USER_B, AUTH_B, hash(secretB)]));
  } finally {
    await recoverRpc();
  }
  assert.equal((await db.query("select count(*)::int as count from public.operator_session_admissions")).rows[0].count, 1);
  assert.equal((await db.query("select notes from public.rainfall_readings where id=1")).rows[0].notes, "historical data");
});

test("account removal does not delete the singleton or permanently block expired-slot replacement", async () => {
  await call("/api/auth/session");
  await db.query("delete from auth.users where id=$1", [USER_A]);
  try {
    await expire();
    assert.equal((await call("/api/auth/session", "B", secretB)).status, 200);
    assert.equal((await leaseRow()).user_id, USER_B);
  } finally { await db.query("insert into auth.users(id) values ($1) on conflict do nothing", [USER_A]); }
});

test("F-02 committed activity retries and older revisions never change expiry again", async () => {
  await call("/api/auth/session");
  await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '2 minutes',last_active_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '9 minutes'");
  const event = { activityRevision: 1, activityAt: new Date().toISOString() };
  const first = await call("/api/auth/activity", "A", secretA, "POST", event);
  assert.equal(first.status, 200);
  const committed = await leaseRow();
  const second = await call("/api/auth/activity", "A", secretA, "POST", event);
  assert.equal(second.body.lease.duplicate, true);
  assert.equal((await leaseRow()).expires_at.getTime(), committed.expires_at.getTime());
  // Even a changed future timestamp on an old revision is never another event.
  await call("/api/auth/activity", "A", secretA, "POST", { ...event, activityAt: new Date(Date.now()+100000).toISOString() });
  assert.equal((await leaseRow()).expires_at.getTime(), committed.expires_at.getTime());
  await expire();
  assert.equal((await call("/api/auth/activity", "A", secretA, "POST", event)).body.code, "SESSION_TIMEOUT");
});

test("F-02 delayed event uses event-time expiry; >45s, future, missing and unversioned activity fail closed", async () => {
  await call("/api/auth/session");
  await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '2 minutes',last_active_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '9 minutes'");
  const time = new Date(Date.now()-30000).toISOString();
  const success = await call("/api/auth/activity", "A", secretA, "POST", { activityRevision: 1, activityAt: time });
  assert.equal(success.status, 200);
  const row = await leaseRow();
  assert.equal(row.expires_at.getTime(), Date.parse(time)+600000);
  const rejects = [
    [{ activityRevision: 2, activityAt: new Date(Date.now()-60000).toISOString() }, "ACTIVITY_STALE"],
    [{ activityRevision: 2, activityAt: new Date(Date.now()+60000).toISOString() }, "INVALID_ACTIVITY"],
    [{ activityRevision: -1, activityAt: time }, "INVALID_ACTIVITY"],
    [{ activityRevision: 2, activityAt: "invalid" }, "INVALID_ACTIVITY"],
    [{}, "INVALID_ACTIVITY"],
  ];
  for (const [body, code] of rejects) {
    assert.equal((await call("/api/auth/activity", "A", secretA, "POST", body)).body.code, code);
    assert.equal((await leaseRow()).expires_at.getTime(), row.expires_at.getTime());
  }
  const legacy = await db.query("select public.operator_session_check($1,$2,$3,'extend') as result", [USER_A, AUTH_A, hash(secretA)]);
  assert.equal(legacy.rows[0].result.code, "INVALID_ACTIVITY");
});

test("F-02 continued distinct interactions extend while polling and refresh preserve the revision", async () => {
  await call("/api/auth/session");
  for (let revision = 1; revision <= 3; revision++) {
    assert.equal((await call("/api/auth/activity", "A", secretA, "POST", {
      activityRevision: revision, activityAt: new Date().toISOString(),
    })).status, 200);
  }
  const row = await leaseRow();
  await call("/api/auth/session-status", "A", secretA, "GET");
  await call("/protected", "A", secretA, "GET");
  assert.deepEqual(await leaseRow(), row);
  assert.equal(Number(row.last_activity_revision), 3);
});

test("F-02 extension RPC execute permission is backend-only and rollback disables it", async () => {
  const sql = "select public.operator_session_extend($1,$2,$3,1,clock_timestamp()) as result";
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(db.query(sql, [USER_A, AUTH_A, hash(secretA)])); }
    finally { await db.exec("reset role"); }
  }
  await call("/api/auth/session");
  const rollback = await readFile(new URL("../database/20261008_global_session_rollback.sql", import.meta.url), "utf8");
  await db.exec(rollback);
  await db.exec("set role service_role");
  try { await assert.rejects(db.query(sql, [USER_A, AUTH_A, hash(secretA)])); }
  finally {
    await recoverRpc();
  }
});

const hardening = () => readFile(new URL("../database/20261008_02_operator_write_permissions.sql", import.meta.url), "utf8");
const assertGuard = async (pattern) => {
  await assert.rejects(db.exec(await hardening()), pattern);
  await db.exec("rollback");
};

test("F-05 cross-schema definer/helper bypass is blocked until exact dangerous paths are revoked locally", async () => {
  await db.exec(`create schema private_probe;
    create function private_probe.helper() returns void language plpgsql as $$begin
      execute 'update public.' || 'rainfall_readings set notes=''bypass'' where id=1'; end$$;
    create function public.indirect_rpc() returns void language sql security definer as 'select private_probe.helper()';`);
  try {
    await assertGuard(/unreviewed invoker routine.*manual chain review/);
    // This is a fixture-specific remediation, never a guessed live revocation.
    await db.exec("revoke execute on function public.indirect_rpc(),private_probe.helper() from public,anon,authenticated");
    await db.exec(await hardening());
    await db.exec("set role anon");
    try { await assert.rejects(db.query("select public.indirect_rpc()"), /permission denied/); }
    finally { await db.exec("reset role"); }
    assert.equal((await db.query("select notes from public.rainfall_readings where id=1")).rows[0].notes, "historical data");
  } finally { await db.exec("drop function public.indirect_rpc(); drop function private_probe.helper(); drop schema private_probe"); }
});

test("F-05 invoker entrypoint with private dynamic definer helper is a manual blocker even without schema USAGE", async () => {
  await db.exec(`create schema private_probe;
    create function private_probe.helper() returns void language plpgsql security definer as $$begin
      execute 'delete from public.' || 'rainfall_readings'; end$$;
    create function public.indirect_rpc() returns void language sql as 'select private_probe.helper()';`);
  try { await assertGuard(/manual chain review required/); }
  finally { await db.exec("drop function public.indirect_rpc(); drop function private_probe.helper(); drop schema private_probe"); }
});

test("F-05 writable view in another schema with column-only grants is blocked", async () => {
  await db.exec(`create schema private_probe; grant usage on schema private_probe to anon;
    create view private_probe.alias as select id,notes from public.rainfall_readings;
    grant update(notes) on private_probe.alias to anon;`);
  try { await assertGuard(/Writable view/); }
  finally { await db.exec("drop view private_probe.alias; drop schema private_probe"); }
});

test("F-05 trigger on another API-writable table cannot silently bypass operator permissions", async () => {
  await db.exec(`create table public.sensor_probe(id int); grant insert on public.sensor_probe to anon;
    create function public.sensor_probe_trigger() returns trigger language plpgsql security definer as $$begin
      update public.rainfall_readings set notes='bypass' where id=1; return new; end$$;
    create trigger indirect_write after insert on public.sensor_probe for each row execute function public.sensor_probe_trigger();`);
  try { await assertGuard(/Unreviewed trigger/); }
  finally { await db.exec("drop table public.sensor_probe; drop function public.sensor_probe_trigger()"); }
});

test("F-05 inherited TRUNCATE grants are detected after direct grant revocation", async () => {
  await db.exec("create role probe_writer; grant truncate on public.rainfall_readings to probe_writer; grant probe_writer to anon");
  try { await assertGuard(/Inherited rainfall write privileges/); }
  finally { await db.exec("revoke probe_writer from anon; revoke all on public.rainfall_readings from probe_writer; drop role probe_writer"); }
});

test("F-05 rules on other publicly writable tables are explicit review blockers", async () => {
  await db.exec(`create table public.sensor_probe(id int); grant insert on public.sensor_probe to anon;
    create rule indirect_write as on insert to public.sensor_probe do also
      update public.rainfall_readings set notes='bypass' where id=1;`);
  try { await assertGuard(/Unreviewed writable rule/); }
  finally { await db.exec("drop table public.sensor_probe"); }
});

test("F-05 role membership in rainfall owner cannot bypass RLS", async () => {
  await db.exec(`create role probe_owner; grant usage,create on schema public to probe_owner;
    alter table public.rainfall_readings owner to probe_owner; grant probe_owner to anon;`);
  try { await assertGuard(/assume rainfall owner/); }
  finally { await db.exec("alter table public.rainfall_readings owner to postgres; revoke probe_owner from anon; revoke all on schema public from probe_owner; drop role probe_owner"); }
});

test("F-02 new migration collision stops transaction and preserves the current slot", async () => {
  await call("/api/auth/session"); const original = await leaseRow();
  const sql = await readFile(new URL("../database/20261010_03_operator_activity_revision.sql", import.meta.url),"utf8");
  await assert.rejects(db.exec(sql),/already exists/);
  await db.exec("rollback");
  assert.deepEqual(await leaseRow(),original);
  assert.equal((await call("/protected","A",secretA,"GET")).status,200);
});

test("F-05 existing exact timestamp trigger and read-only view remain usable", async () => {
  await db.exec(`alter table public.rainfall_readings add column updated_at timestamptz;
    create function public.set_updated_at() returns trigger language plpgsql as $$begin
      new.updated_at = timezone('utc', now()); return new; end;$$;
    create trigger set_rainfall_readings_updated_at before update on public.rainfall_readings
      for each row execute function public.set_updated_at();
    create view public.read_probe as select id,rainfall_value from public.rainfall_readings;
    grant select on public.read_probe to anon;`);
  try {
    await db.exec(await hardening());
    await db.exec("set role anon");
    try { assert.equal((await db.query("select * from public.read_probe")).rows.length, 1); }
    finally { await db.exec("reset role"); }
  } finally { await db.exec("drop view public.read_probe; drop trigger set_rainfall_readings_updated_at on public.rainfall_readings; drop function public.set_updated_at(); alter table public.rainfall_readings drop column updated_at"); }
});

test("F-04 every preflight statement executes in READ ONLY transaction and redacts embedded secrets", async () => {
  await db.exec(`create schema private_probe;
    create function private_probe.secret_probe() returns text language sql as $$select 'probe-secret-value'::text$$;
    alter table public.rainfall_readings alter column notes set default 'probe-secret-value';`);
  try {
    const sql = await readFile(new URL("./support/sessionPreflightQuery.sql", import.meta.url), "utf8");
    await db.exec("begin read only");
    const results = await db.exec(sql);
    assert.ok(results.length >= 25);
    assert.equal(JSON.stringify(results).includes("probe-secret-value"), false);
    assert.ok(JSON.stringify(results).includes("private_probe"));
    await db.exec("rollback");
  } finally {
    await db.exec("rollback; drop function private_probe.secret_probe(); drop schema private_probe; alter table public.rainfall_readings alter column notes drop default");
  }
});
