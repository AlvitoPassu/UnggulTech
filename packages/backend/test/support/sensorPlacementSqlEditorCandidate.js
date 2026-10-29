// Test-only batch preparation for a NEW loopback cluster from the native harness.
// Synthetic fixture evidence is never written into the deliverable SQL candidate.
import assert from "node:assert/strict";
import { SQL, quote } from "./sensorPlacementDatabase.js";
import { approvalKey, approvalToken, auditKey, checkerKey, auditDefinition } from "./sensorPlacementProductionCandidate.js";

export const EDITOR_CANDIDATE = "20261029_04_sensor_placements_SQL_EDITOR_CANDIDATE.sql";
export const referenceKey = "unggul.sensor_placements_approval_reference";
export const targetKey = "unggul.sensor_placements_target_database";
export const approvalKeys = [approvalKey, referenceKey, targetKey, checkerKey, auditKey];
export const approvalStateSql = `select jsonb_object_agg(k,current_setting(k,true)) as result
  from unnest(array[${approvalKeys.map(quote).join(",")}]) k`;
export async function assertNoEditorApproval(db) {
  const state = await db.json(approvalStateSql);
  for (const key of approvalKeys) assert.ok(state[key] === null || state[key] === "", `${key} must have no approval value`);
}

export async function localEditorBatch(db, { overrides = {}, omit = [] } = {}) {
  const target = await db.json(`select jsonb_build_object('database',current_database(),
    'host',current_setting('listen_addresses'),'version',current_setting('server_version_num'),
    'directory',current_setting('data_directory'),'checker',md5(pg_get_functiondef(
      'public.operator_session_check(uuid,uuid,text,text)'::regprocedure))) as result`);
  assert.equal(target.host, "127.0.0.1"); assert.equal(target.database, "postgres");
  assert.equal(target.version, "170006");
  assert.match(target.directory.replaceAll("\\", "/"), /\/unggul-placement-native-[^/]+\/data$/);
  const expression = await db.json(auditDefinition);
  const actions = [...expression.matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map(m => m[1]);
  // Some negative tests intentionally install a 12-action or malformed constraint.
  const values = {
    [approvalKey]: approvalToken,
    [referenceKey]: "LOCAL-FIXTURE-STAGE5C34-ONLY",
    [targetKey]: target.database,
    [checkerKey]: target.checker,
    [auditKey]: JSON.stringify(actions),
    ...overrides,
  };
  let sql = await SQL(EDITOR_CANDIDATE);
  for (const key of approvalKeys) {
    const slot = `set local ${key} = '';`;
    assert.equal(sql.split(slot).length, 2, `exactly one empty slot for ${key}`);
    sql = sql.replace(slot, omit.includes(key) ? `-- omitted fixture setting: ${key}` : `set local ${key} = ${quote(values[key])};`);
  }
  return { sql, actions };
}
