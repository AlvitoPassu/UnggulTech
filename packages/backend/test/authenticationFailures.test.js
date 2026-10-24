import test from "node:test";
import assert from "node:assert/strict";
import { createAuthMiddleware } from "../src/middleware/authMiddleware.js";
import { createOperatorDatabase, rpcClient, USER_A, AUTH_A } from "./support/operatorDatabase.js";

const identity = { user: { id: USER_A }, authSessionId: AUTH_A, sessionHash: "a".repeat(64) };
const request = () => ({ headers: { authorization: "Bearer fixture", "x-session-id": "a".repeat(64) } });
const client = () => ({
  auth: {
    getUser: async () => ({ data: { user: identity.user } }),
    getClaims: async () => ({ data: { claims: { sub: USER_A, session_id: AUTH_A, exp: Date.now() / 1000 + 3600 } } }),
  },
  rpc: async () => { throw new Error("RPC must not be called while identifying"); },
});

for (const stage of ["getUser", "getClaims"]) {
  for (const failure of ["502", "network", "invalid_jwt"]) test(`Auth ${stage} ${failure} rejects protected access`, async () => {
    const provider = client();
    provider.auth[stage] = async () => {
      if (failure === "network") throw new Error("network unavailable");
      return { error: failure === "502" ? { status: 502 } : { status: 401, code: "invalid_jwt" } };
    };
    const auth = createAuthMiddleware({ client: provider, audit: async () => {} });
    await assert.rejects(auth.identify(request()), error => error.code === (failure === "invalid_jwt" ? "TOKEN_EXPIRED" : "AUTH_UNAVAILABLE"));
  });
}

for (const claims of [
  { sub: "other-user", session_id: AUTH_A, exp: Date.now()/1000+3600 },
  { sub: USER_A, exp: Date.now()/1000+3600 },
  { sub: USER_A, session_id: AUTH_A, exp: Date.now()/1000-1 },
]) test(`verified claims fail closed: ${claims.sub !== USER_A ? "subject mismatch" : !claims.session_id ? "missing provider session" : "expired token"}`, async () => {
  const provider = client(); provider.auth.getClaims = async () => ({ data: { claims } });
  await assert.rejects(createAuthMiddleware({client:provider}).identify(request()), error => error.code === "TOKEN_EXPIRED");
});

for (const result of [{error:{code:"PGRST202"}}, {error:{status:502}}, {data:null}, {data:{code:"UNKNOWN"}}, "throw"]) {
  test(`RPC failure ${typeof result === "string" ? result : JSON.stringify(result)} never calls the protected handler`, async () => {
    const provider = client();
    provider.rpc = async () => { if (result === "throw") throw new Error("database disconnected"); return result; };
    const auth = createAuthMiddleware({client:provider,audit:async()=>{}});
    let status, payload, reached = false;
    const res = { status(value) { status=value;return this; }, json(value) {payload=value;} };
    await auth.requireAuth({...request(),path:"/protected"},res,()=>{reached=true;});
    assert.equal(reached,false);assert.equal(status,503);assert.equal(payload.code,"SESSION_DATABASE_UNAVAILABLE");
  });
}

test("audit database failure rolls admission and slot back atomically, then retry succeeds", async () => {
  const db=await createOperatorDatabase();
  try {
    await db.exec("alter table public.audit_logs add constraint inject_audit_failure check(action<>'LOGIN_SUCCESS')");
    const auth=createAuthMiddleware({client:{...client(),...rpcClient(db)},audit:async()=>{}});
    await assert.rejects(auth.operate(identity,"acquire"),error=>error.code==="SESSION_DATABASE_UNAVAILABLE");
    assert.equal((await db.query("select user_id from public.global_operator_session")).rows[0].user_id,null);
    assert.equal((await db.query("select count(*)::int as n from public.operator_session_admissions")).rows[0].n,0);
    await db.exec("alter table public.audit_logs drop constraint inject_audit_failure");
    assert.equal((await auth.operate(identity,"acquire")).created,true);
  } finally {await db.close();}
});
