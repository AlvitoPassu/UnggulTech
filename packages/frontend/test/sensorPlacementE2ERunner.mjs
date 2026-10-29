// Isolated React -> ACTUAL Express server -> native PostgreSQL RPC -> GET -> React.
// Hosted Auth is emulated; PostgREST query-builder transport is translated to real SQL.
import "../../backend/test/support/localOnly.js";
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createVite } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createNativePlacementCluster } from "../../backend/test/support/sensorPlacementNativeDatabase.js";
import { bootstrapPlacementBase, SQL, PLACEMENT_MIGRATION, optIn, resetSql, snapshotSql, payload as basePayload, quote, USER_A, AUTH_A, signature } from "../../backend/test/support/sensorPlacementDatabase.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactRoot = resolve(root, "../..");
const nullLocation = process.env.UNGGUL_TEST_NULL_LOCATION === "true";
const payload = (overrides = {}) => basePayload({ ...(nullLocation ? { expectedContext: { location: null, bedengan: 1 } } : {}), ...overrides });
const user = { id: USER_A, aud: "authenticated", role: "authenticated", email: "operator@fixture.invalid", user_metadata: { full_name: "Operator fixture" }, app_metadata: { provider: "email", providers: ["email"] }, created_at: new Date().toISOString() };
const jwt = (session_id, seconds = 3600) => `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: USER_A, session_id, exp: Math.floor(Date.now() / 1000) + seconds, aud: "authenticated", role: "authenticated" })).toString("base64url")}.local-fixture-signature`;
const tokenA = jwt(AUTH_A), tokenB = jwt("10000000-0000-4000-8000-000000000003"), expiredToken = jwt(AUTH_A, -10);
const issuedTokens = new Set([tokenA, tokenB, expiredToken]);
const secretA = "a".repeat(64), secretB = "b".repeat(64);
const authHeaders = (token = tokenA, secret = secretA) => ({ Authorization: `Bearer ${token}`, "X-Session-Id": secret, "Content-Type": "application/json" });
const outcomes = [], requests = [], rpcPids = [];
let cluster, db, backend, backendPort, vite, server, browser, profile;
let backendLog = "", result, currentConfig = { source: "db", flag: "true" }, fault = {}, controlId = 0, baseline;
let completed = false, finalDatabaseState, monitoringUnchanged = false;
const controlledMetadataChanges = [];
const pidHistory = [];
const freePort = async () => {
  const listener = httpServer(); await new Promise(done => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port; await new Promise(done => listener.close(done)); return port;
};
const test = async (name, action) => {
  try { await action(); outcomes.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { outcomes.push({ name, passed: false, error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); throw error; }
};
const observe = async () => ({
  nullLocation,
  placements: await db.json("select coalesce(jsonb_agg(jsonb_build_object('id',sensor_id::text,'row',row_index,'column',column_index,'version',version::text) order by sensor_id),'[]') as result from public.sensor_placements"),
  audits: await db.json("select count(*)::int as result from public.audit_logs where action='SENSOR_PLACEMENT_SAVE'"),
  requests: requests.map(({ method, path, body, status }) => ({ method, path, body, status })), pidHistory, cluster: cluster.folder,
});
const sqlRequest = async (message, child) => {
  let connection;
  try {
    connection = await cluster.connect(); await connection.exec("set role service_role");
    if (message.query.includes("public.sensor_placement_save(")) rpcPids.push(await connection.json("select pg_backend_pid() as result"));
    let rows;
    if (/^select /i.test(message.query)) rows = await connection.json(`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) as result from (${message.query}) t`);
    else { await connection.exec(message.query); rows = []; }
    if (child.connected) child.send({ id: message.id, rows });
  } catch (error) {
    if (child.connected) child.send({ id: message.id, error: { code: error.code || "08006", message: error.message } });
  } finally { await connection?.close(); }
};
const configure = async patch => {
  currentConfig = { ...currentConfig, ...patch };
  const id = ++controlId;
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error("Backend config timeout")), 5000);
    const receive = message => { if (message.configured === id) { clearTimeout(timeout); backend.off("message", receive); done(); } };
    backend.on("message", receive); backend.send({ id, configure: { ...currentConfig, tokens: [...issuedTokens] } });
  });
};
const stopBackend = async () => {
  if (!backend || backend.exitCode !== null) return;
  const stopped = new Promise(done => backend.once("exit", done)); backend.kill(); await stopped;
};
const startBackend = async () => {
  const child = fork(fileURLToPath(new URL("../../backend/test/support/sensorPlacementE2EWorker.mjs", import.meta.url)), [String(backendPort)], {
    env: { ...process.env, E2E_ISSUED_TOKENS: JSON.stringify([...issuedTokens]) },
    windowsHide: true, silent: true,
  });
  backend = child;
  child.stdout.on("data", chunk => { backendLog += chunk; }); child.stderr.on("data", chunk => { backendLog += chunk; });
  child.on("message", message => { if (message.query) void sqlRequest(message, child); });
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Actual server startup timeout: ${backendLog}`)), 20000);
    child.on("error", reject); child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Backend exited ${code}: ${backendLog}`)); });
    child.on("message", message => { if (message.ready) { clearTimeout(timeout); pidHistory.push(message.pid); done(); } });
  });
  // Entry point binds asynchronously after import.
  for (let attempt = 0; ; attempt++) {
    try { assert.equal((await fetch(`http://127.0.0.1:${backendPort}/health`)).status, 200); break; }
    catch (error) { if (attempt > 50) throw error; await delay(100); }
  }
  await configure(currentConfig);
};
const api = async (path, { method = "GET", body, token = tokenA, secret = secretA } = {}) => {
  const response = await fetch(`http://127.0.0.1:${backendPort}${path}`, { method, headers: token ? authHeaders(token, secret) : { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
};
const put = (body, options = {}) => api(options.path || "/api/sensors/126/placement", { ...options, method: "PUT", body });
const login = () => api("/api/auth/session", { method: "POST", body: {} });
const failAudit = async enabled => db.exec(enabled
  ? "create function public.e2e_reject_audit() returns trigger language plpgsql as $$ begin if new.action='SENSOR_PLACEMENT_SAVE' then raise exception 'local audit fault'; end if; return new; end $$; create trigger e2e_reject_audit before insert on public.audit_logs for each row execute function public.e2e_reject_audit()"
  : "drop trigger e2e_reject_audit on public.audit_logs; drop function public.e2e_reject_audit()");

try {
  cluster = await createNativePlacementCluster(); db = await cluster.connect();
  console.log(`Native PostgreSQL ${await db.json("select to_jsonb(current_setting('server_version')) as result")}; NEW isolated cluster ${cluster.folder}`);
  await bootstrapPlacementBase(db, { native: true }); await db.exec(optIn); await db.exec(await SQL(PLACEMENT_MIGRATION));
  if (nullLocation) await db.exec("update public.sensors set location=null");
  baseline = await db.json(snapshotSql); backendPort = await freePort(); await startBackend();

  await test("Actual server: anonymous/expired credentials denied; valid global session admitted", async () => {
    assert.equal((await put(payload(), { token: null })).status, 401);
    assert.equal((await put(payload(), { token: expiredToken })).status, 401);
    assert.equal((await login()).status, 200); assert.equal((await put(payload())).status, 200);
  });
  await test("Actual RPC: corners, string version increments, occupied point, metadata and version conflicts", async () => {
    let response = await put(payload({ row: 10, column: 100, expectedVersion: "1" }));
    assert.equal(response.status, 200); assert.equal(response.body.version, "2");
    for (const [body, options, status, code] of [
      [payload({ row: 10, column: 100 }), { path: "/api/sensors/127/placement" }, 409, "PLACEMENT_OCCUPIED"],
      [payload({ expectedVersion: "1" }), {}, 409, "PLACEMENT_VERSION_CONFLICT"],
      [payload({ expectedVersion: "2", expectedContext: { location: "Different", bedengan: 1 } }), {}, 409, "SENSOR_CONTEXT_CHANGED"],
      [payload(), { path: "/api/sensors/999999/placement" }, 404, "SENSOR_NOT_FOUND"],
    ]) { response = await put(body, options); assert.equal(response.status, status); assert.equal(response.body.code, code); }
    assert.equal((await observe()).audits, 2);
  });
  await test("Actual RPC: invalid coordinates rejected without position or success audit mutation", async () => {
    const before = await observe();
    for (const row of [0, -1, 1.5, 11, "1", "", null]) assert.equal((await put(payload({ row, expectedVersion: "2" }))).status, 400);
    for (const column of [0, -1, 1.5, 101, "", null]) assert.equal((await put(payload({ column, expectedVersion: "2" }))).status, 400);
    const after = await observe(); assert.deepEqual(after.placements, before.placements); assert.equal(after.audits, before.audits);
  });
  await test("Actual PostgreSQL: audit failure rolls back placement and version atomically", async () => {
    const before = await observe(); await failAudit(true);
    try { assert.notEqual((await put(payload({ row: 5, expectedVersion: "2" }))).status, 200); }
    finally { await failAudit(false); }
    const after = await observe(); assert.deepEqual(after.placements, before.placements); assert.equal(after.audits, before.audits);
  });
  await test("Actual PostgreSQL: anon/authenticated cannot execute RPC, read or write placement; service cannot bypass RPC DML", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const connection = await cluster.connect(); await connection.exec(`set role ${role}`);
      try {
        if (role !== "service_role") {
          await assert.rejects(connection.exec(`select public.sensor_placement_save('${USER_A}','${AUTH_A}','${"a".repeat(64)}','126','{}'::jsonb)`), { code: "42501" });
          await assert.rejects(connection.exec("select * from public.sensor_placements"), { code: "42501" });
        }
        await assert.rejects(connection.exec("update public.sensor_placements set row_index=5"), { code: "42501" });
      } finally { await connection.close(); }
    }
    assert.equal(await db.json(`select to_jsonb(exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=${quote(signature)}::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')) as result`), false);
  });
  await test("Actual server: flag off / JSON source cannot write; monitoring remains public", async () => {
    const before = await observe();
    await configure({ flag: "false" }); assert.equal((await put(payload({ expectedVersion: "2" }))).status, 503);
    await configure({ flag: "true", source: "json" }); assert.equal((await put(payload({ expectedVersion: "2" }))).status, 503);
    assert.equal((await api("/api/sensors/126/data", { token: null })).body.moisture, 55);
    await configure({ source: "db" }); const after = await observe(); assert.deepEqual(after.placements, before.placements); assert.equal(after.audits, before.audits);
  });
  await test("Actual server + two independent native connections: concurrent updates yield one commit, one 409", async () => {
    const holder = await cluster.connect(); await holder.exec("begin; select * from public.global_operator_session for update");
    const before = rpcPids.length;
    const operations = [put(payload({ row: 4, column: 44, expectedVersion: "2" })), put(payload({ row: 5, column: 55, expectedVersion: "2" }))];
    await delay(200); await holder.exec("commit"); await holder.close();
    const responses = await Promise.all(operations); assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(new Set(rpcPids.slice(before)).size, 2); assert.equal((await observe()).audits, 3);
  });
  await test("Actual server: different-device admission and writes denied; logged-out session cannot write", async () => {
    assert.equal((await api("/api/auth/session", { method: "POST", body: {}, token: tokenB, secret: secretB })).status, 409);
    assert.equal((await put(payload({ expectedVersion: "3" }), { token: tokenB, secret: secretB })).status, 401);
    assert.equal((await api("/api/auth/logout", { method: "POST", body: {} })).status, 200);
    assert.equal((await put(payload({ expectedVersion: "3" }))).status, 401);
  });
  await test("Actual PostgreSQL stopped: no JSON fallback or successful write; same database recovers", async () => {
    await cluster.stop();
    assert.notEqual((await api("/api/sensors", { token: null })).status, 200);
    assert.equal((await put(payload({ expectedVersion: "3" }))).status, 503);
    await cluster.start(); db = await cluster.connect(); assert.equal((await observe()).placements[0].version, "3");
  });
  await test("Placement operations preserve registry, moisture, pH and historical/rainfall tables byte for byte", async () => {
    assert.deepEqual(await db.json(snapshotSql), baseline);
    assert.equal((await api("/api/sensors/126/data", { token: null })).body.moisture, 55);
    assert.equal((await api("/api/sensors/ph", { token: null })).body.soilPh, 6.4);
  });
  // Browser starts at first-placement state. It owns real AuthContext admission.
  await db.exec(resetSql); requests.length = 0;
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  let session = { access_token: tokenA, refresh_token: "synthetic-refresh-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  server = httpServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
      if (url.pathname.startsWith("/auth/v1/")) {
        if (url.pathname === "/auth/v1/token") {
          const credentials = JSON.parse(await bodyText(req));
          if (url.searchParams.get("grant_type") === "password") {
            if (credentials.email !== user.email || credentials.password !== "local-only-synthetic-password") return json({ error: "invalid_grant", error_description: "Synthetic credentials rejected" }, 400);
            const token = jwt(crypto.randomUUID()); issuedTokens.add(token); await configure({});
            session = { ...session, access_token: token };
          } else if (credentials.refresh_token !== session.refresh_token) return json({ error: "invalid_grant" }, 400);
          return json(session);
        }
        if (url.pathname === "/auth/v1/user") return json(user);
        if (url.pathname === "/auth/v1/logout") return json({});
        return json({ error: "Unsupported synthetic Auth endpoint" }, 404);
      }
      if (url.pathname === "/__e2e__/results") {
        if (req.method === "POST") { result = JSON.parse(await bodyText(req)); return json({ ok: true }); }
        return json(result || null);
      }
      if (url.pathname === "/__e2e__/state") return json(await observe());
      if (url.pathname === "/__e2e__/control" && req.method === "POST") {
        const command = JSON.parse(await bodyText(req));
        if (command.action === "restart") { await stopBackend(); await startBackend(); }
        else if (command.action === "configure") await configure(command.patch);
        else if (command.action === "fault") fault = command.patch;
        else if (command.action === "expire") await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '12 minutes',expires_at=clock_timestamp()-interval '1 second',last_active_at=clock_timestamp()-interval '11 minutes'");
        else if (command.action === "auditFailure") await failAudit(command.enabled);
        else if (command.action === "placementAccess") await db.exec(`${command.enabled ? "grant select on" : "revoke select on"} public.sensor_placements ${command.enabled ? "to" : "from"} service_role`);
        else if (command.action === "externalUpdate") {
          const identity = await db.json("select jsonb_build_object('auth',auth_session_id,'hash',app_session_hash,'version',(select version::text from public.sensor_placements where sensor_id=126)) as result from public.global_operator_session");
          const saved = await db.json(`select public.sensor_placement_save('${USER_A}',${quote(identity.auth)},${quote(identity.hash)},'126',${quote(JSON.stringify(payload({ row: 8, column: 88, expectedVersion: identity.version })))}::jsonb) as result`);
          assert.equal(saved.code, "OK");
        }
        else if (command.action === "contextDrift") {
          await db.exec(`update public.sensors set bedengan=${command.enabled ? "'2'" : "'B1'"} where id=126`);
          if (!command.enabled) {
            // The existing updated_at trigger correctly records OUR deliberate
            // metadata edit. Account only for that exact fixture field, while
            // preserving comparisons of every other registry/measurement field.
            const restored = await db.json("select to_jsonb(s) as result from public.sensors s where id=126");
            const original = baseline.sensors.find(sensor => sensor.id === 126);
            assert.deepEqual(restored, { ...original, updated_at: restored.updated_at });
            controlledMetadataChanges.push({ sensorId: "126", field: "updated_at", before: original.updated_at, after: restored.updated_at, reason: "Harness context drift then restoration; existing timestamp trigger" });
          }
        }
        else throw new Error("Unknown fixed E2E control");
        return json(await observe());
      }
      if (url.pathname.startsWith("/api/")) {
        const body = ["GET", "HEAD"].includes(req.method) ? undefined : await bodyText(req);
        const record = { method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null }; requests.push(record);
        if (fault.readback && req.method === "GET" && url.pathname === "/api/sensors") { record.status = 503; return json({ message: "Injected local network read failure" }, 503); }
        const upstream = await fetch(`http://127.0.0.1:${backendPort}${req.url}`, { method: req.method,
          headers: { "Content-Type": "application/json", ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}), ...(req.headers["x-session-id"] ? { "X-Session-Id": req.headers["x-session-id"] } : {}) }, ...(body === undefined ? {} : { body }) });
        let responseBody = await upstream.text(); record.status = upstream.status;
        if (req.method === "PUT" && url.pathname.endsWith("/placement")) {
          // Faults occur AFTER the actual Express/SQL transaction and response.
          if (fault.malformed && upstream.status === 200) responseBody = JSON.stringify({ code: "OK", version: 99 });
          if (fault.delay) await delay(fault.delay);
        }
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("Content-Type") || "application/json" }); return res.end(responseBody);
      }
      vite.middlewares(req, res);
    } catch (error) { json({ error: error.message }, 500); }
  });
  const bodyText = async request => { let text = ""; for await (const chunk of request) text += chunk; return text; };
  vite = await createVite({ root, configFile: false, envDir: false, plugins: [react(), tailwindcss(), {
    name: "local-e2e-network-boundary",
    transformIndexHtml() { return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data: blob:;" }, injectTo: "head-prepend" }, { tag: "script", injectTo: "head-prepend", children: "window.__e2eErrors=[]; addEventListener('error',e=>window.__e2eErrors.push(e.message)); addEventListener('unhandledrejection',e=>window.__e2eErrors.push(String(e.reason)));" }]; },
  }], define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(origin), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("synthetic-anon-key-only") }, server: { middlewareMode: true, hmr: { server }, watch: null } });
  await new Promise(done => server.listen(port, "127.0.0.1", done));
  const executable = process.env.SENSOR_MAP_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe"; await access(executable);
  profile = await mkdtemp(join(tmpdir(), "unggul-placement-e2e-browser-"));
  browser = spawn(executable, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--window-size=1600,1000", `--user-data-dir=${profile}`, `${origin}/test/sensor-placement-e2e.html`], { windowsHide: true, stdio: "ignore" });
  browser.on("error", error => { result = { failures: 1, outcomes: [{ name: "Browser launch", passed: false, error: error.message }] }; });
  console.log(`REAL APP E2E ONLY ${origin}; actual backend PID ${backend.pid}`);
  const deadline = Date.now() + 240_000;
  while (!result && Date.now() < deadline) await delay(250);
  if (!result) throw new Error("Integrated browser did not finish within 240 seconds");
  for (const outcome of result.outcomes) { outcomes.push(outcome); console.log(`${outcome.passed ? "PASS" : "FAIL"} ${outcome.name}${outcome.error ? `: ${outcome.error}` : ""}`); }
  assert.equal(result.failures, 0, "Integrated browser failures");
  await test("Post-run integrity: measurements/history unchanged; registry restored with only explicitly tracked fixture edit timestamp", async () => {
    const expected = structuredClone(baseline);
    for (const change of controlledMetadataChanges) expected.sensors.find(sensor => String(sensor.id) === change.sensorId)[change.field] = change.after;
    assert.deepEqual(await db.json(snapshotSql), expected);
    monitoringUnchanged = true;
    finalDatabaseState = await observe();
    assert.ok(pidHistory.length >= 2 && pidHistory[0] !== pidHistory.at(-1));
  });
  console.log(`RESTART evidence: backend PIDs ${pidHistory.join(" -> ")}; SAME PostgreSQL data directory ${cluster.folder}`);
  completed = true;
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally {
  console.log(`E2E TOTAL ${outcomes.filter(o => o.passed).length}/${outcomes.length}; simulated: hosted Auth and PostgREST transport; real: React/AuthContext/Express/session RPC/placement RPC/native PG/audit.`);
  await writeFile(join(artifactRoot, `sensor_position_stage5c8${nullLocation ? "_null" : ""}_e2e_results.json`), JSON.stringify({ completed, nullLocation, outcomes, pidHistory, cluster: cluster?.folder, rpcPids, monitoringUnchanged, controlledMetadataChanges, finalDatabaseState, browser: result, backendLog }, null, 2));
  if (browser && browser.exitCode === null) { const stopped = new Promise(done => browser.once("exit", done)); browser.kill(); await stopped; }
  await vite?.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await stopBackend(); await cluster?.close();
  if (profile) {
    const target = resolve(profile), allowed = resolve(tmpdir()) + sep;
    if (target.startsWith(allowed) && target.slice(allowed.length).startsWith("unggul-placement-e2e-browser-")) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}
