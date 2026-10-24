import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOperatorDatabase } from "./support/operatorDatabase.js";
import { syntheticStorageTriggerFixtureSql, assertSyntheticStorageMigration,
  assertSyntheticStorageAttacksRejected, storageMetadata, storageDefinitions,
  assertSyntheticStorageMetadata, assertStorageMutationRejected, storageArgumentMutations } from "./support/syntheticStorageFixture.js";

import { triggerHardeningSql, triggerSnapshotSql } from "./support/syntheticTriggerFixture.js";

let db;
before(async () => {
  db = await createOperatorDatabase({ migrations: ["20261008_01_global_operator_session.sql"] });
  await db.exec(syntheticStorageTriggerFixtureSql);
});
after(async () => { await db?.close(); });

test("synthetic catalog matches all seven contracts, including control update tgnargs=0 and exact tgargs", async () => {
  await assertSyntheticStorageMetadata(db);
  const { rows } = await db.query(`select tgnargs,encode(tgargs,'hex') as arguments_hex from pg_trigger
    where tgrelid='storage.buckets'::regclass and tgname='protect_bucket_control_update'`);
  assert.deepEqual(rows, [{ tgnargs: 0, arguments_hex: "" }]);
});

test("unmodified Migration 02 rejects synthetic source atomically", async () => {
  const baseline = (await db.query(triggerSnapshotSql)).rows;
  await assert.rejects(db.exec(triggerHardeningSql), /Unreviewed trigger/);
  await db.exec("rollback");
  assert.deepEqual((await db.query(triggerSnapshotSql)).rows, baseline);
});

for (const [name, sql, diagnostic] of storageArgumentMutations) {
  test(`Storage argument regression rejects ${name} atomically`, async () => {
    await assertStorageMutationRejected(db, sql, diagnostic);
  });
}

test("seven synthetic Storage contracts exercise 01 -> test-adapted 02 -> 03", async () => {
  assert.equal(storageMetadata.length, 7);
  assert.equal(storageDefinitions.length, 5);
  await assertSyntheticStorageMigration(db);
  await db.exec(await readFile(new URL("../database/20261010_03_operator_activity_revision.sql", import.meta.url), "utf8"));
  await assertSyntheticStorageMigration(db); // idempotent test-adapted rerun
});

test("exact Storage exemption rejects new entrypoints, metadata/source drift, helper/dynamic/view writes and WHEN code atomically", async () => {
  await assertSyntheticStorageAttacksRejected(db);
});

test("reviewed Storage exemption preserves rainfall denies, historical reads and service-role IoT ingestion", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      assert.equal((await db.query("select notes from public.rainfall_readings where id=1")).rows[0].notes, "historical data");
      for (const sql of ["insert into public.rainfall_readings(id) values(99)",
        "update public.rainfall_readings set notes='attack'", "delete from public.rainfall_readings", "truncate public.rainfall_readings"]) {
        await assert.rejects(db.exec(sql), e => e.code === "42501");
      }
    } finally { await db.exec("reset role"); }
  }
  await db.exec(`set role service_role;
    insert into public.rainfall_readings(id) values(2);
    update public.rainfall_readings set rainfall_value=20 where id=2;
    delete from public.rainfall_readings where id=2;
    insert into public.sensors(id) values(2); reset role;`);
  assert.equal((await db.query("select count(*)::int as n from public.sensors")).rows[0].n, 2);
});
