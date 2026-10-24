import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createOperatorDatabase, rpcClient } from "./support/operatorDatabase.js";

test("real backend process restart preserves the lease, rejects same-account B, and restores A without admission",async()=>{
  const db=await createOperatorDatabase();let worker;
  const start=()=>new Promise((resolve,reject)=>{
    const child=fork(fileURLToPath(new URL("./support/backendRestartWorker.js",import.meta.url)),[],{
      execArgv:["--import",new URL("./support/localOnly.js",import.meta.url).href],
      windowsHide:true,stdio:["ignore","ignore","pipe","ipc"],
    });
    worker=child;
    let stderr="";child.stderr.on("data",chunk=>{stderr+=chunk;});
    child.on("error",reject);
    child.on("exit",code=>reject(new Error(`backend child exited ${code}: ${stderr}`)));
    child.on("message",async message=>{
      if(message.ready)return resolve(message);
      const result=await rpcClient(db).rpc(message.name,message.args);
      if(child.connected)child.send({id:message.id,result});
    });
  });
  const stop=async()=>{if(worker&&worker.exitCode===null){const exited=once(worker,"exit");worker.kill();await exited;}worker=null;};
  const request=async(port,path,token="A",method="GET")=>{
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:`Bearer ${token}`,"X-Session-Id":(token==="A"?"a":"b").repeat(64)}});
    return {status:response.status,body:await response.json()};
  };
  try {
    const first=await start();assert.equal((await request(first.port,"/api/auth/session","A","POST")).body.lease.created,true);
    const lease=(await db.query("select * from public.global_operator_session")).rows[0];
    await stop();const second=await start();assert.notEqual(second.pid,first.pid);
    assert.equal((await request(second.port,"/api/auth/session-status")).status,200);
    assert.equal((await request(second.port,"/protected")).status,200);
    assert.equal((await request(second.port,"/api/auth/session","B","POST")).body.code,"GLOBAL_SESSION_BUSY");
    assert.equal((await request(second.port,"/api/auth/session","A","POST")).body.lease.created,false);
    assert.deepEqual((await db.query("select * from public.global_operator_session")).rows[0],lease);
    assert.equal((await db.query("select count(*)::int as n from public.operator_session_admissions")).rows[0].n,1);
  } finally {await stop();await db.close();}
});
