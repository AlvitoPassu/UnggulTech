import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOperatorDatabase } from "./support/operatorDatabase.js";

for (const role of ["anon", "authenticated"]) {
  for (const inherit of [true, false]) test(`Migration 01 rejects ${role} ${inherit ? "inherited" : "assumable"} RPC EXECUTE atomically`, async () => {
    await assert.rejects(createOperatorDatabase({
      migrations: ["20261008_01_global_operator_session.sql"],
      beforeMigration: db => db.exec(`create role session_executor;
        alter role ${role} ${inherit ? "inherit" : "noinherit"};
        grant session_executor to ${role};
        alter default privileges grant execute on functions to session_executor;`),
    }), /Operator RPC permission contract/);
  });
}

for (const role of ["anon", "authenticated", "service_role"]) test(`Migration 01 rejects inherited private-table privileges for ${role}`, async () => {
  await assert.rejects(createOperatorDatabase({
    migrations: ["20261008_01_global_operator_session.sql"],
    beforeMigration: db => db.exec(`create role session_reader; grant session_reader to ${role};
      alter default privileges grant select on tables to session_reader;`),
  }), /Private operator table permission contract/);
});

test("Migration 03 aborts atomically if an API role can assume an RPC executor", async () => {
  const db = await createOperatorDatabase({migrations: ["20261008_01_global_operator_session.sql", "20261008_02_operator_write_permissions.sql"]});
  try {
    await db.exec(`create role session_executor; alter role authenticated noinherit;
      grant session_executor to authenticated;
      alter default privileges grant execute on functions to session_executor;`);
    const sql = await readFile(new URL("../database/20261010_03_operator_activity_revision.sql", import.meta.url), "utf8");
    await assert.rejects(db.exec(sql), /Operator RPC permission contract/);
    await db.exec("rollback");
    assert.equal((await db.query("select to_regprocedure('public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)') as rpc")).rows[0].rpc, null);
    assert.equal((await db.query("select count(*)::int as n from pg_attribute where attrelid='public.global_operator_session'::regclass and attname='last_activity_revision'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("Migration 02 rejects assumable rainfall TRUNCATE privileges", async () => {
  await assert.rejects(createOperatorDatabase({
    beforeMigration: db => db.exec(`create role rainfall_executor; alter role authenticated noinherit;
      grant rainfall_executor to authenticated;
      grant truncate on public.rainfall_readings to rainfall_executor;`),
  }), /Inherited rainfall write privileges remain/);
});
