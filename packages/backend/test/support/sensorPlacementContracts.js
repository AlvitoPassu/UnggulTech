import assert from "node:assert/strict";
import { acquireSql, saveSql, payload, role, signature, snapshotSql, USER_A, USER_B, AUTH_A, HASH } from "./sensorPlacementDatabase.js";

const count = (db) => db.json("select count(*)::int as result from public.sensor_placements");
const audits = (db) => db.json("select coalesce(jsonb_agg(to_jsonb(t) order by created_at),'[]') as result from public.audit_logs t where action='SENSOR_PLACEMENT_SAVE'");
const login = (db) => role(db, "service_role", async () => assert.equal((await db.json(acquireSql)).code, "OK"));
const save = (db, id, values) => role(db, "service_role", () => db.json(saveSql(id, values)));

export const placementContracts = [
  ["table uses unscaled numeric, explicit RESTRICT FK, PK, unique point, RLS and trusted RPC settings", async (db) => {
    const schema = await db.json(`select jsonb_build_object(
      'numeric',(select jsonb_agg(atttypmod order by attname) from pg_attribute where attrelid='public.sensor_placements'::regclass and attname in ('row_index','column_index')),
      'restrict',(select confdeltype from pg_constraint where conrelid='public.sensor_placements'::regclass and confrelid='public.sensors'::regclass),
      'rls',(select relrowsecurity from pg_class where oid='public.sensor_placements'::regclass),
      'policies',(select count(*) from pg_policy where polrelid='public.sensor_placements'::regclass),
      'definer',(select prosecdef from pg_proc where oid='${signature}'::regprocedure),
      'config',(select proconfig from pg_proc where oid='${signature}'::regprocedure)) as result`);
    assert.deepEqual(schema.numeric, [-1, -1]); assert.equal(schema.restrict, "r");
    assert.equal(schema.rls, true); assert.equal(schema.policies, 0); assert.equal(schema.definer, true);
    assert.ok(schema.config.includes('search_path=""'));
    assert.equal(await count(db), 0);
  }],
  ["all 1000 valid pairs including four corners save with existing identity and atomic success audit", async (db) => {
    await login(db);
    const before = await db.json(snapshotSql);
    const expiry = await db.json("select to_jsonb(expires_at) as result from public.global_operator_session");
    await role(db, "service_role", () => db.exec(`do $$ declare r int; c int; k int:=0; result jsonb; begin
      for r in 1..10 loop for c in 1..100 loop
        result:=public.sensor_placement_save('${USER_A}','${AUTH_A}','${HASH}','126',
          jsonb_build_object('row',r,'column',c,'expectedVersion',case when k=0 then null else k::text end,
            'expectedContext',jsonb_build_object('location','Nursery test','bedengan',1)));
        if result->>'code'<>'OK' then raise exception 'Unexpected save: %',result; end if;
        k:=k+1;
      end loop; end loop; end $$`));
    assert.equal(await count(db), 1);
    const events = await audits(db);
    assert.equal(events.length, 1000);
    assert.equal(events[0].metadata.old_position, null);
    assert.equal(events[0].metadata.operator_id, USER_A);
    assert.equal(events[0].resource_id, "126"); assert.equal(events[0].metadata.outcome, "success");
    assert.deepEqual(events.at(-1).metadata.new_position, { row: 10, column: 100, location: "Nursery test", bedengan: 1, version: "1000" });
    assert.ok(events.at(-1).created_at);
    assert.ok(!JSON.stringify(events).includes(HASH));
    assert.deepEqual(await db.json(snapshotSql), before);
    assert.equal(await db.json("select to_jsonb(expires_at) as result from public.global_operator_session"), expiry);
  }],
  ["RPC rejects invalid coordinates, payload types and credentials in body without writes", async (db) => {
    await login(db);
    for (const [field, maximum] of [["row", 10], ["column", 100]]) {
      for (const value of [0, -1, maximum + 1, 1.5, null, "1", "1.0", "abc", "", true, [], {}]) {
        assert.equal((await save(db, "126", payload({ [field]: value }))).code, "INVALID_PLACEMENT");
      }
      const missing = payload(); delete missing[field];
      assert.equal((await save(db, "126", missing)).code, "INVALID_PLACEMENT");
    }
    for (const bad of [null, [], "text", true, {}, payload({ user_id: USER_B }), payload({ session_secret: "do-not-store" })]) {
      assert.equal((await save(db, "126", bad)).code, "INVALID_PLACEMENT");
    }
    assert.equal(await count(db), 0); assert.equal((await audits(db)).length, 0);
  }],
  ["table constraints reject fractional numeric values without rounding, nulls, duplicates and unknown FKs", async (db) => {
    const insert = (id, row, column, location = "'Nursery test'", bed = "1", version = "1") =>
      db.exec(`insert into public.sensor_placements(sensor_id,location_key,bed_number,row_index,column_index,version) values(${id},${location},${bed},${row},${column},${version})`);
    for (const [r, c] of [["0", "1"], ["-1", "1"], ["11", "1"], ["1.5", "1"], ["1", "0"], ["1", "-1"], ["1", "101"], ["1", "1.5"], ["'NaN'", "1"], ["'Infinity'", "1"]]) {
      await assert.rejects(insert("126", r, c), (e) => e.code === "23514");
    }
    for (const [r, c] of [["null", "1"], ["1", "null"]]) await assert.rejects(insert("126", r, c), (e) => e.code === "23502");
    await assert.rejects(insert("126", "'abc'", "1"), (e) => e.code === "22P02");
    await assert.rejects(insert("999", "1", "1"), (e) => e.code === "23503");
    for (const location of ["''", "' '", "E'\\t'", "U&'\\00A0'", "' Nursery test'"]) await assert.rejects(insert("126", "1", "1", location), (e) => e.code === "23514");
    for (const bed of ["0", "61"]) await assert.rejects(insert("126", "1", "1", undefined, bed), (e) => e.code === "23514");
    await assert.rejects(insert("126", "1", "1", undefined, undefined, "0"), (e) => e.code === "23514");
    await insert("126", "1", "1");
    await assert.rejects(insert("126", "2", "2"), (e) => e.code === "23505");
    await assert.rejects(insert("127", "1", "1"), (e) => e.code === "23505");
    const before = await db.json(snapshotSql);
    await assert.rejects(db.exec("delete from public.sensors where id=126"), (e) => ["23503", "23001"].includes(e.code));
    assert.deepEqual(await db.json(snapshotSql), before);
  }],
  ["optimistic versions prevent lost updates, no-op preserves version and audit, audit carries old and new", async (db) => {
    await login(db);
    assert.equal((await save(db, "126", payload({ expectedVersion: "1" }))).code, "PLACEMENT_VERSION_CONFLICT");
    assert.equal((await save(db, "126", payload())).version, "1");
    assert.equal((await save(db, "126", payload())).code, "PLACEMENT_VERSION_CONFLICT");
    const update = payload({ row: 10, column: 100, expectedVersion: "1" });
    const first = await save(db, "126", update);
    assert.equal(first.version, "2");
    assert.equal((await save(db, "126", update)).code, "PLACEMENT_VERSION_CONFLICT");
    const unchanged = await save(db, "126", { ...update, expectedVersion: "2" });
    assert.equal(unchanged.unchanged, true); assert.equal(unchanged.version, "2");
    const events = await audits(db); assert.equal(events.length, 2);
    assert.deepEqual(events[1].metadata.old_position, { row: 1, column: 1, bedengan: 1, location: "Nursery test", version: "1" });
    assert.equal(events[1].metadata.new_position.row, 10);
    for (const value of [0, "0", 1, true, "1.0", "1e0", "9223372036854775808"]) {
      assert.equal((await save(db, "126", payload({ expectedVersion: value }))).code, "INVALID_EXPECTED_VERSION");
    }
    const missing = payload(); delete missing.expectedVersion;
    assert.equal((await save(db, "126", missing)).code, "INVALID_PLACEMENT");
  }],
  ["same point conflicts only within the same location/bed; registry determines context", async (db) => {
    await login(db);
    assert.equal((await save(db, "126", payload())).code, "OK");
    assert.equal((await save(db, "127", payload())).code, "PLACEMENT_OCCUPIED");
    assert.equal((await save(db, "128", payload({ expectedContext: { location: "Nursery test", bedengan: 2 } }))).code, "OK");
    assert.equal((await save(db, "129", payload({ expectedContext: { location: "Other nursery", bedengan: 1 } }))).code, "OK");
    assert.equal((await save(db, "130", payload())).code, "SENSOR_CONTEXT_CHANGED");
    assert.equal((await save(db, "131", payload())).code, "SENSOR_CONTEXT_INCOMPLETE");
    assert.equal((await save(db, "126", payload({ expectedVersion: "1", expectedContext: { location: "Other nursery", bedengan: 1 } }))).code, "SENSOR_CONTEXT_CHANGED");
    assert.equal(await count(db), 3);
  }],
  ["six synthetic NULL sensors save on beds 1-6, update/no-op with exact versions and atomic NULL audits", async (db) => {
    await db.exec("begin");
    try {
      await db.exec(`insert into public.sensors(id,sensor_name,bedengan,location)
        select n,'Synthetic NULL sensor '||n,'Bedengan '||n,null from generate_series(1,6) n`);
      await login(db);
      const before = await db.json(snapshotSql);
      for (let id = 1; id <= 6; id++) {
        const body = payload({ expectedContext: { location: null, bedengan: id } });
        const first = await save(db, String(id), body);
        assert.equal(first.code, "OK"); assert.equal(first.version, "1"); assert.equal(first.unchanged, false);
        assert.deepEqual(first.context, { location: null, bedengan: id });
        const update = { ...body, row: 10, column: 100, expectedVersion: "1" };
        const second = await save(db, String(id), update);
        assert.equal(second.version, "2"); assert.equal(second.unchanged, false);
        const noop = await save(db, String(id), { ...update, expectedVersion: "2" });
        assert.equal(noop.unchanged, true); assert.equal(noop.version, "2"); assert.equal(noop.updatedAt, second.updatedAt);
      }
      assert.equal(await count(db), 6);
      const events = await audits(db); assert.equal(events.length, 12);
      assert.ok(events.every(e => e.metadata.new_position.location === null));
      assert.deepEqual(await db.json(snapshotSql), before);
    } finally { await db.exec("rollback"); }
  }],
  ["NULL uniqueness is enforced directly in SQL and RPC, independent of literal 'null' or other locations", async (db) => {
    await db.exec("begin");
    try {
      await login(db);
      await db.exec("update public.sensors set location=null where id in (126,127,128)");
      const body = payload({ expectedContext: { location: null, bedengan: 1 } });
      assert.equal((await save(db, "126", body)).code, "OK");
      assert.equal((await save(db, "127", body)).code, "PLACEMENT_OCCUPIED");
      await db.exec("savepoint direct_collision");
      await assert.rejects(db.exec("insert into public.sensor_placements(sensor_id,location_key,bed_number,row_index,column_index) values(127,null,1,1,1)"), e => e.code === "23505");
      await db.exec("rollback to direct_collision");
      assert.equal((await save(db, "128", payload({ expectedContext: { location: null, bedengan: 2 } }))).code, "OK");
      assert.equal((await save(db, "129", payload({ expectedContext: { location: "Other nursery", bedengan: 1 } }))).code, "OK");
      await db.exec("update public.sensors set location='null' where id=127");
      assert.equal((await save(db, "127", payload({ expectedContext: { location: "null", bedengan: 1 } }))).code, "OK");
      assert.equal(await count(db), 4); assert.equal((await audits(db)).length, 4);
    } finally { await db.exec("rollback"); }
  }],
  ["RPC rejects missing/empty/invalid location and bed values, preserves NULL versus string transitions", async (db) => {
    await login(db);
    for (const location of ["", " ", "\t\ufeff", " Nursery test", 0, true, [], {}]) {
      assert.equal((await save(db, "130", payload({ expectedContext: { location, bedengan: 1 } }))).code, "INVALID_PLACEMENT");
    }
    for (const expectedContext of [{ bedengan: 1 }, { other: null, bedengan: 1 }, { location: null }, { location: null, bedengan: 1, extra: 1 },
      ...[0, 61, 1.5, null, "1", false].map(bedengan => ({ location: null, bedengan }))]) {
      assert.equal((await save(db, "130", payload({ expectedContext }))).code, "INVALID_PLACEMENT");
    }
    await db.exec("begin");
    try {
      const body = payload({ expectedContext: { location: null, bedengan: 1 } });
      assert.equal((await save(db, "130", body)).version, "1");
      await db.exec("update public.sensors set location='Nursery test' where id=130");
      assert.equal((await save(db, "130", { ...body, expectedVersion: "1" })).code, "SENSOR_CONTEXT_CHANGED");
      const stringBody = payload({ expectedVersion: "1" });
      assert.equal((await save(db, "130", stringBody)).version, "2");
      await db.exec("update public.sensors set location=null where id=130");
      assert.equal((await save(db, "130", { ...stringBody, expectedVersion: "2" })).code, "SENSOR_CONTEXT_CHANGED");
      assert.equal((await save(db, "130", { ...body, expectedVersion: "2" })).version, "3");
      assert.equal((await audits(db)).length, 3);
    } finally { await db.exec("rollback"); }
  }],
  ["NULL insert/update audit failures roll back location, coordinates, version and success audit", async (db) => {
    await login(db);
    const body = payload({ expectedContext: { location: null, bedengan: 1 } });
    const install = "create function public.null_audit_failure() returns trigger language plpgsql as $$ begin if new.action='SENSOR_PLACEMENT_SAVE' then raise exception 'NULL audit fault'; end if; return new; end $$; create trigger null_audit_failure before insert on public.audit_logs for each row execute function public.null_audit_failure()";
    const remove = "drop trigger null_audit_failure on public.audit_logs; drop function public.null_audit_failure()";
    await db.exec(install);
    try { await assert.rejects(save(db, "130", body), /NULL audit fault/); }
    finally { await db.exec(remove); }
    assert.equal(await count(db), 0); assert.equal((await audits(db)).length, 0);
    await save(db, "130", body);
    const before = await db.json("select to_jsonb(p) as result from public.sensor_placements p where sensor_id=130");
    await db.exec(install);
    try { await assert.rejects(save(db, "130", { ...body, row: 2, expectedVersion: "1" }), /NULL audit fault/); }
    finally { await db.exec(remove); }
    assert.deepEqual(await db.json("select to_jsonb(p) as result from public.sensor_placements p where sensor_id=130"), before);
    assert.equal((await audits(db)).length, 1);
  }],
  ["strict bigint IDs remain strings and do not create identities; Unicode whitespace matches UI normalization", async (db) => {
    await login(db);
    for (const id of [null, "0", "-1", "1.0", "1e0", " 126", "126x", "9223372036854775808"]) {
      assert.equal((await save(db, id, payload())).code, "INVALID_SENSOR_ID");
    }
    assert.equal((await save(db, "999", payload())).code, "SENSOR_NOT_FOUND");
    const big = await save(db, "9007199254740993", payload({ expectedContext: { location: "Nursery test", bedengan: 60 } }));
    assert.equal(big.sensorId, "9007199254740993");
    await db.exec("update public.sensors set location=U&'\\FEFFNursery test\\00A0',bedengan=U&'Bedengan\\00A01' where id=126");
    try { assert.equal((await save(db, "126", payload())).code, "OK"); }
    finally { await db.exec("update public.sensors set location='Nursery test',bedengan='B1' where id=126"); }
  }],
  ["audit failure rolls back insert AND update, including timestamps/version and prior success log", async (db) => {
    await login(db);
    await db.exec("alter table public.audit_logs add constraint placement_test_audit_failure check(action<>'SENSOR_PLACEMENT_SAVE')");
    try { await assert.rejects(save(db, "126", payload()), (e) => e.code === "23514"); }
    finally { await db.exec("alter table public.audit_logs drop constraint placement_test_audit_failure"); }
    assert.equal(await count(db), 0);
    await save(db, "126", payload());
    // Trigger simulates an outage even when an earlier success audit already exists.
    await db.exec(`create function public.placement_test_audit_failure() returns trigger language plpgsql as $$ begin
      if new.action='SENSOR_PLACEMENT_SAVE' then raise exception 'injected audit failure'; end if; return new; end $$;
      create trigger placement_test_audit_failure before insert on public.audit_logs for each row execute function public.placement_test_audit_failure()`);
    const before = await db.json("select to_jsonb(p) as result from public.sensor_placements p where sensor_id=126");
    try { await assert.rejects(save(db, "126", payload({ row: 2, expectedVersion: "1" })), /injected audit failure/); }
    finally { await db.exec("drop trigger placement_test_audit_failure on public.audit_logs; drop function public.placement_test_audit_failure()"); }
    assert.deepEqual(await db.json("select to_jsonb(p) as result from public.sensor_placements p where sensor_id=126"), before);
    assert.equal((await audits(db)).length, 1);
  }],
  ["anon/authenticated have no SELECT, column write, table write, TRUNCATE or RPC; service_role has read/RPC only", async (db) => {
    for (const name of ["anon", "authenticated", "service_role"]) {
      await role(db, name, async () => {
        for (const sql of [
          "insert into public.sensor_placements(sensor_id,location_key,bed_number,row_index,column_index) values(126,'Nursery test',1,1,1)",
          "update public.sensor_placements set row_index=1", "delete from public.sensor_placements", "truncate public.sensor_placements",
        ]) await assert.rejects(db.exec(sql), (e) => e.code === "42501");
        if (name !== "service_role") {
          await assert.rejects(db.exec("select row_index from public.sensor_placements"), (e) => e.code === "42501");
          await assert.rejects(db.exec(saveSql()), (e) => e.code === "42501");
        } else assert.equal(await count(db), 0);
      });
    }
  }],
  ["RPC reuses session identity/TTL, rejects mismatch and release; invalid auth never writes", async (db) => {
    assert.equal((await save(db, "126", payload())).code, "SESSION_NOT_FOUND");
    await login(db);
    for (const [user, auth, hash] of [[USER_B, AUTH_A, HASH], [USER_A, "10000000-0000-4000-8000-000000000099", HASH], [USER_A, AUTH_A, "b".repeat(64)]]) {
      assert.equal((await role(db, "service_role", () => db.json(saveSql("126", payload(), user, auth, hash)))).code, "SESSION_MISMATCH");
    }
    await role(db, "service_role", () => db.json(`select public.operator_session_check('${USER_A}','${AUTH_A}','${HASH}','release') as result`));
    assert.equal((await save(db, "126", payload())).code, "SESSION_NOT_FOUND");
    assert.equal(await count(db), 0);
  }],
  ["expired session and emergency shutdown cannot authorize a write even with owner RPC EXECUTE", async (db) => {
    await login(db);
    await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '12 minutes',last_active_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute'");
    assert.equal((await save(db, "126", payload())).code, "SESSION_TIMEOUT");
    assert.equal((await db.json("select count(*)::int as result from public.audit_logs where action='SESSION_EXPIRED'")), 1);
    assert.equal(await count(db), 0);
    // Replace only INSIDE a transaction in the isolated fixture, then roll back.
    await db.exec("begin");
    try {
      await db.exec(`create or replace function public.operator_session_check(p_user_id uuid,p_auth_session_id uuid,p_app_session_hash text,p_operation text default 'validate')
        returns jsonb language plpgsql security invoker set search_path='' as $$ begin raise exception using errcode='55000',message='Operator session authorization disabled by emergency rollback'; end $$`);
      await assert.rejects(db.exec(saveSql()), (e) => e.code === "55000");
    } finally { await db.exec("rollback"); }
    assert.equal(await count(db), 0);
  }],
];
