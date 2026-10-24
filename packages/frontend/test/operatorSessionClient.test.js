import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers";
import { withOperatorAuthLock } from "../src/lib/candidateAuth.js";
import { OperatorSessionClient, SESSION_ID_KEY, GLOBAL_SESSION_BUSY_MESSAGE,
  loginErrorMessage, normalizeAuthError, shouldAttachOperatorCredentials, createSessionSecret } from "../src/lib/operatorSessionClient.js";

const secret = "a".repeat(64);
const token = (signature = "test") => `e30.${Buffer.from(JSON.stringify({ session_id: "auth-a" })).toString("base64url")}.${signature}`;
const session = { access_token: token(), refresh_token: "refresh-a", user: { id: "user-a" } };
const apiError = (status, code) => Object.assign(new Error(code), { response: { status, data: { code, message: code } } });
const setup = () => {
  let clock = 1000;
  const calls = [], signouts = [], stored = new Map();
  const storage = { getItem: (key) => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) };
  const lease = (remaining = 600_000) => ({ serverNow: new Date(clock).toISOString(), expiresAt: new Date(clock + remaining).toISOString() });
  const auth = {
    signInWithPassword: async () => ({ data: { session }, error: null }),
    getSession: async () => ({ data: { session }, error: null }),
    signOut: async (options) => { signouts.push(options); return { error: null }; },
    setSession: async () => ({ data: { session }, error: null }),
  };
  const api = {
    get: async (path, options) => { calls.push({ path, options }); return { data: { lease: lease() } }; },
    post: async (path, body, options) => { calls.push({ path, body, options }); return { data: { lease: lease(), released: true } }; },
  };
  const client = new OperatorSessionClient({ auth, createCandidate: () => ({ ...auth }), withAuthLock: (action) => action(),
    api, storage, now: () => clock, makeSecret: () => secret });
  return { client, auth, api, storage, calls, signouts, lease, setClock: (value) => { clock = value; } };
};

test("successful login waits for backend and synchronously provides credentials for queued actions", async () => {
  const { client, api } = setup();
  let resolve;
  api.post = () => new Promise((done) => { resolve = done; });
  const result = client.login("operator", "password");
  await new Promise((done) => setImmediate(done));
  assert.notEqual(client.status, "authenticated");
  resolve({ data: { lease: { serverNow: new Date(1000).toISOString(), expiresAt: new Date(601000).toISOString() } } });
  await result;
  assert.equal(client.status, "authenticated");
  assert.equal(client.headers().Authorization, `Bearer ${session.access_token}`);
  assert.equal(client.headers()["X-Session-Id"], secret);
});

test("busy rejection uses exact message and only local Supabase signout", async () => {
  const { client, api, signouts, storage } = setup();
  api.post = async () => { throw apiError(409, "GLOBAL_SESSION_BUSY"); };
  await assert.rejects(client.login("operator", "password"), (error) => loginErrorMessage(error) === GLOBAL_SESSION_BUSY_MESSAGE);
  assert.equal(client.status, "unauthenticated");
  assert.deepEqual(signouts, [{ scope: "local" }]);
  assert.equal(storage.getItem(SESSION_ID_KEY), null);
});

test("wrong credentials do not sign out an existing provider session", async () => {
  const { client, auth, signouts } = setup();
  auth.signInWithPassword = async () => ({ error: { code: "invalid_credentials" } });
  await assert.rejects(client.login("operator", "wrong"));
  assert.equal(signouts.length, 0);
  assert.match(loginErrorMessage({ code: "invalid_credentials" }), /password salah/);
});

test("lost acquisition response keeps isolated identity in memory until validation confirms admission", async () => {
  const { client, api, storage, calls, signouts } = setup();
  api.post = async () => { throw new Error("network lost"); };
  await assert.rejects(client.login("operator", "password"));
  assert.equal(client.status, "unavailable");
  assert.equal(storage.getItem(SESSION_ID_KEY), null);
  assert.equal(signouts.length, 0);
  await client.checkStatus();
  assert.equal(client.status, "authenticated");
  assert.equal(storage.getItem(SESSION_ID_KEY), secret);
  assert.equal(calls.filter((call) => call.path === "/api/auth/session").length, 0);
});

test("refresh validates existing identity without changing it or registering; concurrent restoration is deduplicated", async () => {
  const { client, storage, calls } = setup();
  storage.setItem(SESSION_ID_KEY, secret);
  await Promise.all([client.restore(), client.restore()]);
  assert.equal(client.sessionId, secret);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/auth/session-status");
});

test("new tab without application identity never registers or signs out another tab", async () => {
  const { client, calls, signouts } = setup();
  await client.restore();
  assert.equal(client.status, "unauthenticated");
  assert.equal(calls.length, 0);
  assert.equal(signouts.length, 0);
});

test("expired restoration clears locally and never acquires a slot", async () => {
  const { client, api, storage, signouts } = setup();
  storage.setItem(SESSION_ID_KEY, secret);
  api.get = async () => { throw apiError(401, "SESSION_TIMEOUT"); };
  await client.restore();
  assert.equal(client.status, "session_expired");
  assert.deepEqual(signouts, [{ scope: "local" }]);
});

test("backend failure during restoration stays unauthenticated and preserves retry identity", async () => {
  const { client, api, storage } = setup();
  storage.setItem(SESSION_ID_KEY, secret);
  api.get = async () => { throw apiError(503, "SESSION_DATABASE_UNAVAILABLE"); };
  await client.restore();
  assert.equal(client.status, "unavailable");
  assert.equal(storage.getItem(SESSION_ID_KEY), secret);
});

test("HTML backend 502 during admission and validation never authenticates; retry validates the same identity", async () => {
  const {client,api,storage,lease,signouts}=setup();
  const badGateway=()=>Object.assign(new Error("Bad Gateway"),{response:{status:502,data:"<html>502 Bad Gateway</html>"}});
  api.post=async()=>{throw badGateway();};
  await assert.rejects(client.login("operator","password"));
  assert.equal(client.status,"unavailable");assert.equal(storage.getItem(SESSION_ID_KEY),null);
  const identity=client.sessionId;
  api.get=async()=>{throw badGateway();};
  assert.equal(await client.checkStatus(),false);assert.equal(client.status,"unavailable");
  assert.equal(client.sessionId,identity);assert.equal(signouts.length,0);
  api.get=async()=>({data:{lease:lease()}});
  assert.equal(await client.checkStatus(),true);assert.equal(client.status,"authenticated");
  assert.equal(client.sessionId,identity);assert.equal(storage.getItem(SESSION_ID_KEY),identity);
});

test("polling and token refresh do not create slots or extend operator expiry", async () => {
  const { client, calls } = setup();
  await client.login("operator", "password");
  const deadline = client.deadline;
  await client.flushActivity();
  client.refreshToken({ ...session, access_token: token("refreshed") });
  assert.equal(client.deadline, deadline);
  assert.equal(client.headers().Authorization, `Bearer ${token("refreshed")}`);
  assert.equal(calls.filter((call) => call.path === "/api/auth/activity").length, 0);
  assert.equal(calls.filter((call) => call.path === "/api/auth/session").length, 1);
});

test("legitimate activity is throttled and confirmed through backend", async () => {
  const { client, calls, setClock } = setup();
  await client.login("operator", "password");
  setClock(2000); client.recordInteraction();
  await new Promise((done) => setImmediate(done));
  const deadline = client.deadline;
  setClock(3000); client.recordInteraction();
  await client.flushActivity();
  assert.equal(calls.filter((call) => call.path === "/api/auth/activity").length, 1);
  setClock(33000); await client.flushActivity();
  assert.equal(calls.filter((call) => call.path === "/api/auth/activity").length, 2);
  assert.ok(client.deadline > deadline);
});

test("keep-login confirms extension and never resets the deadline on database failure", async () => {
  const { client, api, setClock } = setup();
  await client.login("operator", "password");
  const before = client.deadline;
  setClock(550000);
  client.recordInteraction(false);
  api.post = async () => { throw apiError(503, "SESSION_DATABASE_UNAVAILABLE"); };
  assert.equal(await client.flushActivity(true), false);
  assert.equal(client.deadline, before);
  api.post = async () => ({ data: { lease: { serverNow: new Date(550000).toISOString(), expiresAt: new Date(1150000).toISOString() } } });
  assert.equal(await client.flushActivity(true), true);
  assert.equal(client.deadline, 1150000);
});

test("expired keep-login never revives the session", async () => {
  const { client, api, setClock, calls } = setup();
  await client.login("operator", "password");
  setClock(500000);
  client.recordInteraction(false);
  api.post = async () => { throw apiError(401, "SESSION_TIMEOUT"); };
  assert.equal(await client.flushActivity(true), false);
  assert.equal(client.status, "session_expired");
  assert.equal(calls.filter((call) => call.path === "/api/auth/session").length, 1);
});

test("manual logout waits for backend before signout and checks explicit release confirmation", async () => {
  const { client, api, signouts } = setup();
  await client.login("operator", "password");
  api.post = async () => { assert.equal(signouts.length, 0); return { data: { released: false } }; };
  assert.equal(await client.logout(), false);
  assert.equal(client.status, "authenticated");
  api.post = async () => ({ data: { released: true } });
  assert.equal(await client.logout(), true);
  assert.equal(client.status, "unauthenticated");
  assert.deepEqual(signouts, [{ scope: "local" }]);
});

test("logout network failure retains session and never claims release", async () => {
  const { client, api, signouts } = setup();
  await client.login("operator", "password");
  api.post = async () => { throw new Error("network lost"); };
  assert.equal(await client.logout(), false);
  assert.equal(client.status, "authenticated");
  assert.equal(signouts.length, 0);
  assert.match(client.notice, /belum dikonfirmasi/);
});

test("ten-minute inactivity expires; timeout failure makes no false backend release claim", async () => {
  const { client, api, setClock, signouts } = setup();
  await client.login("operator", "password");
  setClock(client.deadline);
  api.post = async () => { throw new Error("offline"); };
  await client.expire();
  assert.equal(client.status, "session_expired");
  assert.match(client.notice, /Pelepasan slot backend belum dikonfirmasi/);
  assert.deepEqual(signouts, [{ scope: "local" }]);
});

test("late timeout notification does not clear a lease the backend has renewed", async () => {
  const { client, api, lease, signouts } = setup();
  await client.login("operator", "password");
  api.post = async () => { const error = apiError(409, "SESSION_STILL_ACTIVE"); error.response.data.lease = lease(); throw error; };
  await client.expire();
  assert.equal(client.status, "authenticated"); assert.equal(signouts.length, 0);
});

test("Blob error responses and all session error codes clear the operator state", async () => {
  for (const code of ["SESSION_NOT_FOUND", "MISSING_SESSION_ID", "SESSION_MISMATCH", "TOKEN_EXPIRED", "INVALID_SESSION"]) {
    const { client } = setup(); await client.login("operator", "password");
    const error = apiError(401, code); error.response.data = new Blob([JSON.stringify({ code })], { type: "application/json" });
    await client.rejectSession(error);
    assert.notEqual(client.status, "authenticated");
  }
  const error = apiError(500, "other"); error.response.data = new Blob(["non JSON"]);
  assert.equal(await normalizeAuthError(error), error);
});

test("late error from an old request cannot clear a newer operator session", async () => {
  const { client } = setup(); await client.login("operator", "password");
  const old = client.generation; client.clear();
  await client.login("operator", "password");
  await client.rejectSession(apiError(401, "SESSION_MISMATCH"), old);
  assert.equal(client.status, "authenticated");
});

test("credentials are attached only to this site's API and secrets use Web Crypto", () => {
  const origin = "https://monitoring.example.test";
  assert.equal(shouldAttachOperatorCredentials("/api/rainfall", undefined, origin), true);
  assert.equal(shouldAttachOperatorCredentials("https://other.example/api/rainfall", undefined, origin), false);
  assert.equal(shouldAttachOperatorCredentials("/api/rainfall", "https://other.example", origin), false);
  assert.equal(shouldAttachOperatorCredentials("/dashboard", undefined, origin), false);
  const first = createSessionSecret();
  assert.match(first, /^[0-9a-f]{64}$/); assert.notEqual(first, createSessionSecret());
});

test("delayed status response cannot shorten a newer confirmed activity lease", async () => {
  const { client, lease, setClock } = setup();
  await client.login("operator", "password");
  const old = lease();
  setClock(31000);
  client.recordInteraction(false);
  await client.flushActivity(true);
  const deadline = client.deadline;
  client.acceptLease(old, 1000, client.generation);
  assert.equal(client.deadline, deadline);
});

test("a lease that expired during the response delay is never shown as authenticated", () => {
  const { client, setClock } = setup();
  setClock(5000);
  assert.throws(() => client.acceptLease({ serverNow: new Date(1000).toISOString(),
    expiresAt: new Date(2000).toISOString() }, 1000, client.generation), /expired while awaiting/);
  assert.notEqual(client.status, "authenticated");
});

test("F-02 lost activity response reuses immutable revision and discards retries older than 45s", async () => {
  const { client, api, setClock, lease } = setup();
  await client.login("operator", "password");
  const events = [];
  api.post = async (_path, body) => { events.push(body); throw new Error("response lost after commit"); };
  setClock(2000); client.recordInteraction(false);
  await client.flushActivity(true);
  setClock(32000); await client.flushActivity();
  assert.deepEqual(events[0], events[1]);
  assert.equal(events[0].activityRevision, 1);
  assert.equal(events[0].activityAt, new Date(2000).toISOString());
  // Reproduce audit's status-success + activity-response-loss loop. The status
  // lease is fixed at the one committed event, rather than fixture now()+TTL.
  api.get = async () => ({ data: { lease: { ...lease(), expiresAt: new Date(602000).toISOString() } } });
  for (let time = 62000; time < 602000; time += 30000) {
    setClock(time); await client.checkStatus(); await client.flushActivity();
  }
  assert.equal(events.length, 2);
  assert.equal(client.dirty, false);
  setClock(602000); api.post = async () => ({ data: { released: true } });
  await client.expire();
  assert.equal(client.status, "session_expired");
});

test("F-02 trailing event extends from interaction, not the later dispatch", async () => {
  const { client, api, setClock } = setup();
  await client.login("operator", "password");
  api.post = async (_path, body) => ({ data: { lease: {
    serverNow: new Date(33000).toISOString(), expiresAt: new Date(Date.parse(body.activityAt) + 600000).toISOString(),
  } } });
  setClock(3000); client.recordInteraction(false);
  setClock(33000); await client.flushActivity();
  assert.equal(client.deadline, 603000);
  assert.equal(client.pendingActivity, null);
  assert.equal(await client.flushActivity(true), false); // force alone is not an event
});

test("F-02 network latency anchors future events to response receipt conservatively", async () => {
  const { client, api, setClock, calls } = setup();
  const get = api.get;
  await client.login("operator", "password");
  setClock(2000);
  api.get = async (...args) => { const response = await get(...args); setClock(12000); return response; };
  await client.checkStatus();
  setClock(13000); client.recordInteraction(false);
  await client.flushActivity(true);
  const activity = calls.find((call) => call.path === "/api/auth/activity").body;
  assert.equal(activity.activityAt, new Date(3000).toISOString());
});

test("F-03 old status 503 cannot overwrite a newer successful extension", async () => {
  const { client, api, setClock } = setup();
  await client.login("operator", "password");
  let reject;
  api.get = () => new Promise((_resolve, fail) => { reject = fail; });
  const pending = client.checkStatus();
  setClock(3000); client.recordInteraction(false); await client.flushActivity(true);
  const deadline = client.deadline;
  reject(apiError(503, "SESSION_DATABASE_UNAVAILABLE")); await pending;
  assert.equal(client.status, "authenticated");
  assert.equal(client.deadline, deadline);
  assert.equal(client.notice, "");
});

test("F-03 authoritative expiry still invalidates after a newer confirmation", async () => {
  const { client, api, setClock } = setup();
  await client.login("operator", "password");
  let reject;
  api.get = () => new Promise((_resolve, fail) => { reject = fail; });
  const pending = client.checkStatus();
  setClock(3000); client.recordInteraction(false); await client.flushActivity(true);
  reject(apiError(401, "SESSION_TIMEOUT")); await pending;
  assert.equal(client.status, "session_expired");
});

test("F-03 pending status 503 is stale even when extension request started first but committed later", async () => {
  const { client, api, setClock, lease } = setup();
  await client.login("operator", "password");
  let extend, reject;
  api.post = () => new Promise((resolve) => { extend = resolve; });
  setClock(3000); client.recordInteraction(false);
  const activity = client.flushActivity(true);
  api.get = () => new Promise((_resolve, fail) => { reject = fail; });
  const status = client.checkStatus();
  extend({ data: { lease: lease() } }); await activity;
  const deadline = client.deadline;
  reject(apiError(503, "SESSION_DATABASE_UNAVAILABLE")); await status;
  assert.equal(client.status,"authenticated"); assert.equal(client.deadline,deadline);
});

test("F-03 validation recovers unavailable state without acquisition", async () => {
  const { client, api, calls } = setup();
  await client.login("operator", "password");
  const get = api.get, secret = client.sessionId;
  api.get = async () => { throw apiError(503, "SESSION_DATABASE_UNAVAILABLE"); };
  await client.checkStatus(); assert.equal(client.status, "unavailable");
  api.get = get;
  await client.checkStatus();
  assert.equal(client.status, "authenticated"); assert.equal(client.sessionId, secret);
  assert.equal(calls.filter((call) => call.path === "/api/auth/session").length, 1);
});

test("F-03 status responses pending during logout cannot reauthenticate", async () => {
  const { client, api, lease } = setup();
  await client.login("operator", "password");
  let resolve;
  api.get = () => new Promise((done) => { resolve = done; });
  const pending = client.checkStatus();
  await client.logout();
  resolve({ data: { lease: lease() } }); await pending;
  assert.equal(client.status, "unauthenticated"); assert.equal(client.session, null);
});

test("F-01 Supabase refresh with same user but different auth session cannot reuse app identity", async () => {
  const { client } = setup();
  await client.login("operator", "password");
  client.onAuthStateChange("SIGNED_IN", { ...session, access_token: `e30.${Buffer.from(JSON.stringify({ session_id: "other-auth" })).toString("base64url")}.test` });
  assert.equal(client.status, "unauthenticated"); assert.equal(client.sessionId, null);
});

test("F-01 ambiguous admission lost on reload does not persist candidate as active operator", async () => {
  const { client, api, storage, auth } = setup();
  api.post = async () => { throw new Error("offline"); };
  await assert.rejects(client.login("operator", "password"));
  const reloaded = new OperatorSessionClient({ auth, api, storage });
  await reloaded.restore();
  assert.equal(reloaded.status, "unauthenticated");
  assert.equal(storage.getItem(SESSION_ID_KEY), null);
});

test("F-01 shared cleanup and admission promotion are serialized; late cleanup skips a new identity", async () => {
  let pending = Promise.resolve();
  const withAuthLock = (action) => { const result = pending.then(action); pending = result.catch(() => {}); return result; };
  const a = setup(), b = setup();
  const nextSession = { ...session, user: { id: "user-b" } };
  let current = session, finishSignout, promotions = 0, signouts = 0;
  const sharedAuth = {
    getSession: async () => ({ data: { session: current } }),
    signOut: async () => { signouts++; await new Promise((resolve) => { finishSignout = resolve; }); current = null; return {}; },
    setSession: async () => { promotions++; current = nextSession; return { data: { session: current } }; },
  };
  a.client.auth = b.client.auth = sharedAuth;
  a.client.withAuthLock = b.client.withAuthLock = withAuthLock;
  const cleanup = a.client.localSignOut(session,null);
  await new Promise((resolve) => setImmediate(resolve));
  b.client.session = nextSession; b.client.sessionId = secret;
  b.client.candidate = { dispose: async () => {} };
  const promote = b.client.promoteCandidate(b.client.generation);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(promotions,0);
  finishSignout(); await cleanup; await promote;
  assert.equal(current,nextSession);
  await a.client.localSignOut(session,null);
  assert.equal(signouts,1); assert.equal(current,nextSession);
});

test("F-01 malformed admission lease never persists the candidate into operator SDK", async () => {
  const { client, auth, api, storage } = setup();
  let promoted = 0;
  auth.setSession = async () => { promoted++; return { data: { session } }; };
  api.post = async () => ({ data: { lease: {} } });
  await assert.rejects(client.login("operator","password"), /Invalid server lease/);
  assert.equal(promoted,0); assert.equal(storage.getItem(SESSION_ID_KEY),null);
  assert.equal(client.status,"unavailable");
});

test("F-01 unsupported browser coordination fails before provider authentication or admission", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,"navigator");
  Object.defineProperty(globalThis,"navigator",{ configurable: true, value: {} });
  try {
    const { client, calls } = setup();
    let candidates = 0;
    client.withAuthLock = withOperatorAuthLock;
    client.createCandidate = () => { candidates++; };
    await assert.rejects(client.login("operator","password"), { code: "AUTH_COORDINATION_UNAVAILABLE" });
    assert.equal(candidates,0); assert.equal(calls.length,0);
    assert.equal(client.status,"unauthenticated");
  } finally {
    if (descriptor) Object.defineProperty(globalThis,"navigator",descriptor); else delete globalThis.navigator;
  }
});

test("F-03 old access-token expiry cannot invalidate the same auth session after token refresh", async () => {
  const { client, api } = setup();
  await client.login("operator","password");
  let reject;
  api.get = () => new Promise((_resolve, fail) => { reject = fail; });
  const status = client.checkStatus();
  client.refreshToken({ ...session, access_token: token("refreshed") });
  reject(apiError(401,"TOKEN_EXPIRED")); await status;
  assert.equal(client.status,"authenticated");
  await client.rejectSession(apiError(401,"TOKEN_EXPIRED"),client.generation,session.access_token);
  assert.equal(client.status,"authenticated");
});

test("F-01 delayed provider SIGNED_OUT checks current SDK session before changing operator", async () => {
  const { client, auth } = setup();
  await client.login("operator","password");
  client.onAuthStateChange("SIGNED_OUT",null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.status,"authenticated");
  auth.getSession = async () => ({ data: { session: null } });
  client.onAuthStateChange("SIGNED_OUT",null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.status,"unauthenticated");
});

test("F-01 cancelled admission attempts exact release and cleans only candidate without promotion", async () => {
  const { client, api, auth, storage, signouts, lease } = setup();
  let admission, promoted = 0;
  const releases = [];
  auth.setSession = async () => { promoted++; return { data: { session } }; };
  api.post = (path,_body,options) => {
    if (path === "/api/auth/session") return new Promise((resolve) => { admission = resolve; });
    releases.push({ path,headers: options.headers }); return Promise.resolve({ data: { released: true } });
  };
  const pending = client.login("operator","password");
  await new Promise((resolve) => setImmediate(resolve));
  client.clear();
  admission({ data: { lease: lease() } });
  await assert.rejects(pending,/Login cancelled/);
  assert.equal(promoted,0); assert.equal(client.candidate,null);
  assert.equal(storage.getItem(SESSION_ID_KEY),null);
  assert.deepEqual(signouts,[{ scope: "local" }]);
  assert.equal(releases.length,1); assert.equal(releases[0].path,"/api/auth/logout");
  assert.equal(releases[0].headers["X-Session-Id"],secret);
});
