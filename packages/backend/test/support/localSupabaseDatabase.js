// Test-only PostgREST-shaped adapter. All queries use a local PGlite instance
// under service_role; this does not exercise hosted Supabase or PostgREST.
import assert from "node:assert/strict";
import { rpcClient } from "./operatorDatabase.js";

export const localSupabaseDatabase = (db) => {
  let pending = Promise.resolve();
  const asService = (action) => {
    const result = pending.then(async () => {
      await db.exec("set role service_role");
      try { return await action(); } finally { await db.exec("reset role"); }
    });
    pending = result.catch(() => {});
    return result;
  };
  const identifier = (name) => {
    assert.match(name,/^[a-z_][a-z_0-9]*$/i);
    return `"${name}"`;
  };
  const rpc = rpcClient(db);
  return {
    rpc: (...args) => asService(() => rpc.rpc(...args)),
    from(table) {
      assert.ok(["rainfall_readings","audit_logs","sensors","sensor_logs","soil_ph_readings"].includes(table));
      let operation="select", payload, columns="*", mode="many", maximum, ignoreDuplicates=false, requestedSelect=false;
      const conditions=[], ordering=[];
      const chain = {
        select(value="*") { columns=value; requestedSelect=true; return chain; },
        insert(value) { operation="insert"; payload=value; return chain; },
        upsert(value,options) { assert.equal(options.ignoreDuplicates,true); ignoreDuplicates=true; return chain.insert(value); },
        update(value) { operation="update"; payload=value; return chain; },
        eq(name,value) { conditions.push([name,"=",value]); return chain; },
        gte(name,value) { conditions.push([name,">=",value]); return chain; },
        lt(name,value) { conditions.push([name,"<",value]); return chain; },
        order(name,{ascending}) { ordering.push(`${identifier(name)} ${ascending ? "asc" : "desc"}`); return chain; },
        limit(value) { assert.ok(Number.isInteger(value) && value>0); maximum=value; return chain; },
        single() { mode="one"; return chain; },
        maybeSingle() { mode="maybe"; return chain; },
        then(resolve,reject) {
          return asService(async () => {
            const params=[];
            const parameter=value=>{ params.push(value); return `$${params.length}`; };
            const fields=columns==="*" ? "*" : columns.split(",").map(value=>identifier(value.trim())).join(",");
            const where=()=>conditions.length ? " where "+conditions.map(([name,op,value])=>`${identifier(name)} ${op} ${parameter(value)}`).join(" and ") : "";
            let sql;
            if (operation==="insert") {
              const records=Array.isArray(payload) ? payload : [payload];
              const keys=Object.keys(records[0]);
              sql=`insert into public.${identifier(table)} (${keys.map(identifier).join(",")}) values `+
                records.map(record=>`(${keys.map(key=>parameter(record[key])).join(",")})`).join(",")+
                (ignoreDuplicates ? " on conflict(id) do nothing" : "")+(requestedSelect ? ` returning ${fields}` : "");
            } else if (operation==="update") {
              assert.ok(conditions.length>0);
              sql=`update public.${identifier(table)} set `+Object.entries(payload).map(([key,value])=>`${identifier(key)}=${parameter(value)}`).join(",")+where()+(requestedSelect ? ` returning ${fields}` : "");
            } else {
              sql=`select ${fields} from public.${identifier(table)}`+where()+
                (ordering.length ? " order by "+ordering.join(",") : "")+(maximum ? ` limit ${maximum}` : "");
            }
            try {
              // Match the JSON transport boundary, including ISO timestamps.
              const rows=JSON.parse(JSON.stringify((await db.query(sql,params)).rows));
              if(mode==="one") assert.equal(rows.length,1);
              if(mode==="maybe") assert.ok(rows.length<=1);
              return {data:operation!=="select" && !requestedSelect ? null : mode==="many" ? rows : rows[0] ?? null,error:null};
            } catch(error) { return {data:null,error}; }
          }).then(resolve,reject);
        },
      };
      return chain;
    },
  };
};
