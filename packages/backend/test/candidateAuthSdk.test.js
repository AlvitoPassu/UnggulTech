import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import axios from "axios";
import { createCandidateAuth } from "../../frontend/src/lib/candidateAuth.js";
import { OperatorSessionClient, SESSION_ID_KEY } from "../../frontend/src/lib/operatorSessionClient.js";
import { createAuthMiddleware } from "../src/middleware/authMiddleware.js";
import { createAuthRouter } from "../src/routes/authRoutes.js";
import { createOperatorDatabase, rpcClient, USER_A, USER_B } from "./support/operatorDatabase.js";

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key), values };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

// Genuine installed Supabase SDK + native BroadcastChannel + shared storage.
// Only provider HTTP responses are mocked; Express/PGlite authorization is real.
test("F-01 real SDK rejected two-tab candidates preserve first operator storage, identity and protected access", async () => {
  const shared = memoryStorage(), clients = [], issued = new Map(), revoked = [];
  const saved = { window: globalThis.window, document: globalThis.document };
  let db, server, authNumber = 0;
  // Shared mutex models the production Web Lock across the simulated tabs.
  let authMutations = Promise.resolve();
  const withAuthLock = (action) => {
    const next = authMutations.then(action);
    authMutations = next.catch(() => {});
    return next;
  };
  const providerUrl = "https://provider.local.test";
  const provider = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, providerUrl); // no external network
    const headers = new Headers(options.headers);
    if (url.pathname.endsWith("/token")) {
      assert.equal(url.searchParams.get("grant_type"), "password");
      const credentials = JSON.parse(options.body);
      const user = { id: credentials.email.startsWith("b@") ? USER_B : USER_A, email: credentials.email };
      const sessionId = `20000000-0000-4000-8000-${String(++authNumber).padStart(12,"0")}`;
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const jwt = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, session_id: sessionId,
        exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000), aud: "authenticated" })}.${Buffer.alloc(32).toString("base64url")}`;
      issued.set(jwt, { user, sessionId });
      return Response.json({ access_token: jwt, refresh_token: `fixture-refresh-${authNumber}`, user,
        token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600 });
    }
    const jwt = headers.get("authorization")?.replace(/^Bearer /, "");
    assert.ok(issued.has(jwt), `unexpected provider request: ${url.pathname}`);
    if (url.pathname.endsWith("/user")) return Response.json(issued.get(jwt).user);
    if (url.pathname.endsWith("/logout")) {
      assert.equal(url.searchParams.get("scope"), "local");
      revoked.push(jwt);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected mock provider endpoint ${url.pathname}`);
  };
  const makeAuth = (persist = true) => {
    const auth = createClient(providerUrl, "fixture-public-key", { global: { fetch: provider },
      auth: { persistSession: persist, autoRefreshToken: false, detectSessionInUrl: false,
        storage: shared, storageKey: persist ? "shared-operator-auth" : "fixture-backend-auth" } }).auth;
    clients.push(auth); return auth;
  };
  try {
    db = await createOperatorDatabase();
    globalThis.window = { location: { href: "http://localhost/", hash: "", search: "" }, addEventListener() {}, removeEventListener() {} };
    globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
    const auth = createAuthMiddleware({ client: { auth: makeAuth(false), ...rpcClient(db) }, audit: async () => {} });
    const app = express(); app.use(express.json()); app.use("/api/auth", createAuthRouter({ auth, audit: async () => {} }));
    app.get("/api/protected", auth.requireAuth, (req,res) => res.json({ id: req.user.id }));
    server = await new Promise((resolve) => { const listener = app.listen(0,"127.0.0.1",()=>resolve(listener)); });
    const api = axios.create({ baseURL: `http://127.0.0.1:${server.address().port}`, timeout: 5000, proxy: false });
    const makeOperator = (sdk, storage = memoryStorage(), transport = api) => {
      const client = new OperatorSessionClient({ auth: sdk, storage, api: transport, withAuthLock,
        createCandidate: () => { const candidate = createCandidateAuth(providerUrl,"fixture-public-key",{ global: { fetch: provider } }); clients.push(candidate); return candidate; } });
      sdk.onAuthStateChange((event, session) => client.onAuthStateChange(event,session));
      return { client, storage };
    };
    const firstAuth = makeAuth(), secondAuth = makeAuth();
    const first = makeOperator(firstAuth), second = makeOperator(secondAuth);
    await first.client.restore(); await second.client.restore();
    await first.client.login("a", "fixture-password"); await settle();
    const acceptedToken = first.client.session.access_token, appId = first.client.sessionId;
    const storedProvider = shared.getItem("shared-operator-auth");
    const deadline = first.client.deadline;
    for (const identifier of ["b", "a"]) {
      await assert.rejects(second.client.login(identifier,"fixture-password"), (error) => error.response.data.code === "GLOBAL_SESSION_BUSY");
      await settle();
      assert.equal(first.client.status,"authenticated");
      assert.equal(first.client.session.access_token,acceptedToken);
      assert.equal(first.client.sessionId,appId);
      assert.equal(first.client.deadline,deadline);
      assert.equal(shared.getItem("shared-operator-auth"),storedProvider);
      assert.equal((await firstAuth.getSession()).data.session.access_token,acceptedToken);
      assert.equal(second.storage.getItem(SESSION_ID_KEY),null);
      assert.equal((await api.get("/api/protected",{ headers: first.client.headers() })).data.id,USER_A);
    }
    assert.equal(revoked.length,2); assert.equal(revoked.includes(acceptedToken),false);
    // Refresh/restoration retains both identities; no re-acquisition.
    const restored = makeOperator(secondAuth,first.storage);
    assert.equal(await restored.client.restore(),true);
    assert.equal(restored.client.sessionId,appId);
    assert.equal((await db.query("select count(*)::int as n from public.operator_session_admissions")).rows[0].n,1);
    await restored.client.logout(); await settle();
    assert.equal(first.client.status,"unauthenticated"); // intentional admitted logout still propagates
    // Two concurrent SDK candidates still have exactly one DB admission, even
    // with the same shared browser storage. The loser cannot clean the winner.
    const concurrent = await Promise.allSettled([first.client.login("a","fixture-password"), second.client.login("b","fixture-password")]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length,1);
    assert.equal(concurrent.filter((result) => result.status === "rejected" && result.reason.response.data.code === "GLOBAL_SESSION_BUSY").length,1);
    await settle();
    const winner = first.client.status === "authenticated" ? first.client : second.client;
    assert.equal((await api.get("/api/protected",{ headers: winner.headers() })).status,200);
    await winner.logout(); await settle();
    const originalShared = shared.getItem("shared-operator-auth");
    const ambiguous = makeOperator(makeAuth(), memoryStorage(), {
      get: (...args) => api.get(...args),
      post: async (...args) => { const result = await api.post(...args); if (args[0] === "/api/auth/session") throw new Error("lost admission response"); return result; },
    });
    await assert.rejects(ambiguous.client.login("a","fixture-password"),/lost admission response/);
    assert.equal(ambiguous.client.status,"unavailable");
    assert.equal(shared.getItem("shared-operator-auth"),originalShared);
    assert.equal(ambiguous.storage.getItem(SESSION_ID_KEY),null);
    assert.equal(await ambiguous.client.checkStatus(),true);
    assert.equal(ambiguous.client.status,"authenticated");
    assert.equal(ambiguous.storage.getItem(SESSION_ID_KEY),ambiguous.client.sessionId);
    // A delayed signout broadcast from an older admitted session must also be
    // ignored when SDK storage now contains this newly admitted identity.
    const delayedChannel = new BroadcastChannel("shared-operator-auth");
    delayedChannel.postMessage({ event: "SIGNED_OUT", session: null });
    await settle(); delayedChannel.close();
    assert.equal(ambiguous.client.status,"authenticated");
    assert.equal((await api.get("/api/protected",{ headers: ambiguous.client.headers() })).status,200);
    await ambiguous.client.logout();
  } finally {
    for (const client of clients) await client.dispose();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.close();
    if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
  }
});
