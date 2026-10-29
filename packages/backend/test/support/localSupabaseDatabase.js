// Test-only PostgREST-shaped adapter. All queries use a local PGlite instance
// under service_role; this does not exercise hosted Supabase or PostgREST.
import assert from "node:assert/strict";
import { rpcClient } from "./operatorDatabase.js";

export const localSupabaseDatabase = (db, { serialize } = {}) => {
  let pending = Promise.resolve();
  const asService = (action) => {
    const run = async () => {
      await db.exec("set role service_role");
      try { return await action(); } finally { await db.exec("reset role"); }
    };
    if (serialize) return serialize(run);
    const result = pending.then(run);
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
      assert.ok(["rainfall_readings","audit_logs","sensors","sensor_logs","soil_ph_readings","sensor_placements"].includes(table));
      let operation="select", payload, columns="*", mode="many", maximum, offset=0, ignoreDuplicates=false, requestedSelect=false, exactCount=false;
      const conditions=[], ordering=[];
      const chain = {
        select(value="*", options={}) { columns=value; requestedSelect=true; exactCount=options.count==="exact"; return chain; },
        insert(value) { operation="insert"; payload=value; return chain; },
        upsert(value,options) { assert.equal(options.ignoreDuplicates,true); ignoreDuplicates=true; return chain.insert(value); },
        update(value) { operation="update"; payload=value; return chain; },
        eq(name,value) { conditions.push([name,"=",value]); return chain; },
        in(name,value) { assert.ok(Array.isArray(value) && value.length>0); conditions.push([name,"in",value]); return chain; },
        gte(name,value) { conditions.push([name,">=",value]); return chain; },
        lt(name,value) { conditions.push([name,"<",value]); return chain; },
        order(name,{ascending}) { ordering.push(`${identifier(name)} ${ascending ? "asc" : "desc"}`); return chain; },
        limit(value) { assert.ok(Number.isInteger(value) && value>0); maximum=value; return chain; },
        range(start,end) { assert.ok(Number.isInteger(start) && start>=0 && Number.isInteger(end) && end>=start); offset=start; maximum=end-start+1; return chain; },
        single() { mode="one"; return chain; },
        maybeSingle() { mode="maybe"; return chain; },
        then(resolve,reject) {
          return asService(async () => {
            const params=[];
            const parameter=value=>{ params.push(value); return `$${params.length}`; };
            const fields=columns==="*" ? "*" : columns.split(",").map(value=> {
              const [name, cast] = value.trim().split("::");
              if (cast) { assert.equal(cast,"text"); return `${identifier(name)}::text as ${identifier(name)}`; }
              return identifier(name);
            }).join(",");
            const where=()=>conditions.length ? " where "+conditions.map(([name,op,value])=>op==="in"
              ? `${identifier(name)} in (${value.map(parameter).join(",")})`
              : `${identifier(name)} ${op} ${parameter(value)}`).join(" and ") : "";
            let sql, countSql;
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
              const clause=where();
              countSql=`select count(*)::integer as total_count from public.${identifier(table)}`+clause;
              sql=`select ${fields} from public.${identifier(table)}`+clause+
                (ordering.length ? " order by "+ordering.join(",") : "")+(maximum ? ` limit ${maximum}` : "")+(offset ? ` offset ${offset}` : "");
            }
            try {
              // Match the JSON transport boundary, including ISO timestamps.
              const rows=JSON.parse(JSON.stringify((await db.query(sql,params)).rows));
              const total=exactCount ? (await db.query(countSql,params)).rows[0].total_count : null;
              if(mode==="one") assert.equal(rows.length,1);
              if(mode==="maybe") assert.ok(rows.length<=1);
              return {data:operation!=="select" && !requestedSelect ? null : mode==="many" ? rows : rows[0] ?? null,
                ...(exactCount ? {count:total} : {}),error:null};
            } catch(error) { return {data:null,error}; }
          }).then(resolve,reject);
        },
      };
      return chain;
    },
  };
};
