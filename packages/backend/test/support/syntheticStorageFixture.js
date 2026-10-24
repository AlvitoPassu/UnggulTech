import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { syntheticTriggerFixtureSql, syntheticTriggerInventory, triggerHardeningSql,
  triggerSnapshotSql, maliciousTriggerBodies, assertMaliciousStorageTriggerRejected } from "./syntheticTriggerFixture.js";

// Handwritten no-op bodies: these are deliberately NOT hosted Storage source.
// Public identities/flags come from the repository's Migration 02 contract.
const md5 = source => createHash("md5").update(source).digest("hex");
export const storageDefinitions = [...new Set(syntheticTriggerInventory
  .filter(row => row.schema === "storage").map(row => row.fn))].map(fn => {
  const source = `\nbegin /* synthetic local fixture: ${fn} */ return new; end;\n`;
  const config = /protect_bucket_control_columns|enforce_bucket_lifecycle_service_role/.test(fn)
    ? " SET search_path TO 'pg_catalog'" : "";
  return { function_name: fn, source_fingerprint: md5(source),
    function_definition: `CREATE OR REPLACE FUNCTION ${fn} RETURNS trigger LANGUAGE plpgsql${config} AS $function$${source}$function$` };
});

export const storageTriggerContract = syntheticTriggerInventory.filter(row => row.schema === "storage").map(row => {
  const argument = ["protect_bucket_control_insert", "protect_bucket_control_update_role"].includes(row.name);
  const event = {
    enforce_bucket_name_length_trigger: "BEFORE INSERT OR UPDATE OF name",
    protect_bucket_control_insert: "BEFORE INSERT",
    protect_bucket_control_update: "BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation",
    protect_bucket_control_update_role: "AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation",
    protect_buckets_delete: "BEFORE DELETE", protect_objects_delete: "BEFORE DELETE",
    update_objects_updated_at: "BEFORE UPDATE",
  }[row.name];
  const definition = storageDefinitions.find(def => def.function_name === row.fn);
  return {
    schema_name: row.schema, table_name: row.table, trigger_name: row.name,
    trigger_definition: `CREATE TRIGGER ${row.name} ${event} ON storage.${row.table} FOR EACH ${row.type & 1 ? "ROW" : "STATEMENT"} EXECUTE FUNCTION ${row.fn.replace("()", argument ? "('service_role')" : "()")}`,
    when_expression: "null", tgtype: String(row.type), tgenabled: "O", tgisinternal: "false",
    tgnargs: argument ? "1" : "0", arguments_hex: argument ? Buffer.from("service_role\0").toString("hex") : "",
    tgconstraint: "0", tgparentid: "0", function_owner: row.owner, trigger_function: row.fn,
    prosecdef: "false", proleakproof: "false", proretset: "false", prokind: "f", return_type: "trigger",
    pronargs: "0", pronargdefaults: "0", provariadic: "0", prosupport: "-",
    proconfig: definition.function_definition.includes("SET search_path") ? '["search_path=pg_catalog"]' : "null",
    language: "plpgsql", source_fingerprint: definition.source_fingerprint,
  };
});
export const storageMetadata = storageTriggerContract;
const storageContractEvidenceSql = await readFile(new URL("./storageCatalogQuery.sql", import.meta.url), "utf8");

// Test-only adaptation of a string in memory. Never write or deploy this SQL.
// Replace ONLY the seven pinned source hashes; all production guards remain.
// The positive cases exercise guard mechanics, NOT production source approval.
let replaced = 0;
export const syntheticStorageHardeningSql = triggerHardeningSql.replace(
  /(\('(?:buckets|objects)','([^']+)','([^']+)',\d+,')([0-9a-f]{32})(')/g,
  (match, prefix, trigger, fn, originalHash, suffix) => {
    const contract = storageTriggerContract.find(row => row.trigger_name === trigger && row.trigger_function === `storage.${fn}()`);
    assert.ok(contract, `Unexpected migration contract: ${trigger}`);
    assert.notEqual(contract.source_fingerprint, originalHash);
    replaced++;
    return prefix + contract.source_fingerprint + suffix;
  },
);
assert.equal(replaced, 7, "Migration contract changed: review synthetic fixtures explicitly");

const definitionsSql = storageDefinitions.map(row => `${row.function_definition};
  alter function ${row.function_name} owner to supabase_storage_admin;`).join("\n");
const triggersSql = storageTriggerContract.map(row => `${row.trigger_definition};`).join("\n");
export const syntheticStorageOnlyFixtureSql = `
  create role supabase_storage_admin;
  create schema storage authorization supabase_storage_admin;
  grant usage on schema storage to anon,authenticated,service_role;
  create table storage.buckets(id text primary key,updated_at timestamptz,name text,
    type text default 'STANDARD',lifecycle_configuration jsonb,lifecycle_configuration_generation bigint);
  create table storage.objects(id text primary key,updated_at timestamptz);
  alter table storage.buckets owner to supabase_storage_admin;
  alter table storage.objects owner to supabase_storage_admin;
  grant select,insert,update,delete on storage.buckets,storage.objects to anon,authenticated,service_role;
  insert into storage.buckets(id) values('historical-bucket');
  insert into storage.objects(id) values('historical-object');
  ${definitionsSql}
  ${triggersSql}
`;
export const syntheticStorageTriggerFixtureSql = `${syntheticTriggerFixtureSql}
  drop schema storage cascade; drop role supabase_storage_admin;
  ${syntheticStorageOnlyFixtureSql}`;

export async function assertSyntheticStorageMetadata(db) {
  const query = storageContractEvidenceSql.trim().replace(/;$/, "");
  const rows = (await db.query(`select row_to_json(evidence) as details from (${query}) evidence`)).rows;
  assert.equal(rows.length, 7);
  for (const { details } of rows) {
    const expected = storageTriggerContract.find(r => r.schema_name === details.schema_name &&
      r.table_name === details.table_name && r.trigger_name === details.trigger_name);
    assert.ok(expected);
    const actual = Object.fromEntries(Object.entries(details).map(([key, value]) => [key,
      Array.isArray(value) ? JSON.stringify(value) : String(value)]));
    assert.deepEqual(actual, expected, `Every synthetic metadata field must match: ${details.trigger_name}`);
  }
}

export async function assertSyntheticStorageMigration(db) {
  const snapshot = async () => (await db.query(triggerSnapshotSql)).rows[0].result;
  const before = await snapshot();
  await db.exec("begin read only");
  try {
    await assertSyntheticStorageMetadata(db);
  } finally { await db.exec("rollback"); }
  await db.exec(syntheticStorageHardeningSql);
  const after = await snapshot();
  for (const key of ["triggers", "functions", "rainfall", "buckets", "objects"]) assert.deepEqual(after[key], before[key], key);
  const rainfallOid = (await db.query("select 'public.rainfall_readings'::regclass::oid as oid")).rows[0].oid;
  const sensorAndStorageAcl = rows => rows.filter(r => String(r.oid) !== String(rainfallOid));
  assert.deepEqual(sensorAndStorageAcl(after.acl), sensorAndStorageAcl(before.acl));
  for (const row of storageMetadata) {
    const found = (await db.query(`select md5(prosrc) as fingerprint from pg_proc where oid='${row.trigger_function}'::regprocedure`)).rows[0];
    assert.equal(found.fingerprint, row.source_fingerprint);
  }
}

export async function assertStorageMutationRejected(db, sql, diagnostic) {
  await db.exec(sql);
  const before = (await db.query(triggerSnapshotSql)).rows;
  try {
    await assert.rejects(db.exec(syntheticStorageHardeningSql), error => {
      assert.match(error.message, /Unreviewed trigger|manual chain review/);
      assert.match(error.detail || error.message, diagnostic);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual((await db.query(triggerSnapshotSql)).rows, before);
  } finally {
    await db.exec(`rollback; drop schema storage cascade; drop role supabase_storage_admin; ${syntheticStorageOnlyFixtureSql}`);
  }
}

export const storageMetadataMutations = [
  ["new trigger using a reviewed function", "create trigger extra_storage_trigger before update on storage.objects for each row execute function storage.update_updated_at_column()", /extra_storage_trigger/],
  ["reviewed identity on another table", "create table storage.other_objects(id text,updated_at timestamptz); grant update on storage.other_objects to authenticated; create trigger update_objects_updated_at before update on storage.other_objects for each row execute function storage.update_updated_at_column()", /other_objects/],
  ["renamed trigger", "alter trigger update_objects_updated_at on storage.objects rename to changed_name", /changed_name/],
  ["security definer", "alter function storage.update_updated_at_column() security definer", /update_objects_updated_at/],
  ["changed owner", "alter function storage.update_updated_at_column() owner to postgres", /update_objects_updated_at/],
  ["changed function settings", "alter function storage.update_updated_at_column() set search_path=pg_catalog", /update_objects_updated_at/],
  ["removed pinned search_path", "alter function storage.protect_bucket_control_columns() reset all", /protect_bucket_control_insert/],
  ["changed trigger enable mode", "alter table storage.objects enable always trigger update_objects_updated_at", /update_objects_updated_at/],
  ["changed trigger event", "drop trigger update_objects_updated_at on storage.objects; create trigger update_objects_updated_at before insert on storage.objects for each row execute function storage.update_updated_at_column()", /update_objects_updated_at/],
  ["unexpected arguments", "drop trigger update_objects_updated_at on storage.objects; create trigger update_objects_updated_at before update on storage.objects for each row execute function storage.update_updated_at_column('extra')", /update_objects_updated_at/],
  ["constraint trigger", "drop trigger protect_bucket_control_update_role on storage.buckets; create constraint trigger protect_bucket_control_update_role after update of lifecycle_configuration,lifecycle_configuration_generation on storage.buckets deferrable initially deferred for each row execute function storage.enforce_bucket_lifecycle_service_role('service_role')", /protect_bucket_control_update_role/],
  ["WHEN helper outside fingerprinted source", `create schema hidden_probe;
    create function hidden_probe.attack() returns boolean language plpgsql security definer as $$begin update public.rainfall_readings set notes='attack'; return true; end;$$;
    revoke all on function hidden_probe.attack() from public;
    drop trigger update_objects_updated_at on storage.objects;
    create trigger update_objects_updated_at before update on storage.objects for each row
      when(hidden_probe.attack()) execute function storage.update_updated_at_column()`, /update_objects_updated_at/],
];

export const storageArgumentMutations = storageTriggerContract.flatMap(row => {
  const cases = row.tgnargs === "0"
    ? [["unexpected service_role argument", "'service_role'"]]
    : [["same count, different role", "'supabase_storage_admin'"],
      ["same count, trailing whitespace", "'service_role '"],
      ["missing role argument", ""], ["extra empty argument", "'service_role',''"]];
  return cases.map(([name, args]) => [
    `${row.trigger_name}: ${name}`,
    `drop trigger ${row.trigger_name} on ${row.schema_name}.${row.table_name};
      ${row.trigger_definition.replace(/\([^()]*\)$/, `(${args})`)};`,
    new RegExp(row.trigger_name),
  ]);
});

export async function assertSyntheticStorageAttacksRejected(db) {
  for (const [, sql, diagnostic] of [...storageMetadataMutations, ...storageArgumentMutations]) {
    try { await assertStorageMutationRejected(db, sql, diagnostic); }
    finally { await db.exec("drop schema if exists hidden_probe cascade"); }
  }
  // Drift in every reviewed function must fail, even a harmless extra newline.
  for (const row of storageDefinitions) {
    const changed = row.function_definition.replace("$function$", "$function$\n");
    await assertStorageMutationRejected(db, changed, new RegExp(storageMetadata.find(r => r.trigger_function === row.function_name).trigger_name));
  }
  for (const [, body] of maliciousTriggerBodies) await assertMaliciousStorageTriggerRejected(db, body, syntheticStorageHardeningSql);
}
