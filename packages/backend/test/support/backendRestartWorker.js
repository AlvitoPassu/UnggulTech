// Real backend child process with synthetic Auth and SQL RPCs supplied by the
// parent over IPC. The parent owns the isolated local database across restarts.
import express from "express";
import { createAuthMiddleware } from "../../src/middleware/authMiddleware.js";
import { createAuthRouter } from "../../src/routes/authRoutes.js";
import { USER_A, AUTH_A, AUTH_A2 } from "./operatorDatabase.js";

const pending=new Map();let sequence=0;
process.on("message",({id,result})=>{pending.get(id)?.(result);pending.delete(id);});
const client={
  auth:{
    getUser:async token=>({data:{user:["A","B"].includes(token)?{id:USER_A}:null}}),
    getClaims:async token=>({data:{claims:{sub:USER_A,session_id:token==="A"?AUTH_A:AUTH_A2,exp:Date.now()/1000+3600}}}),
  },
  rpc:(name,args)=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);process.send({id,name,args});}),
};
const audit=async()=>{};
const auth=createAuthMiddleware({client,audit});
const app=express();app.use(express.json());app.use("/api/auth",createAuthRouter({auth,audit}));
app.get("/protected",auth.requireAuth,(_req,res)=>res.json({allowed:true}));
const server=app.listen(0,"127.0.0.1",()=>process.send({ready:true,port:server.address().port,pid:process.pid}));
