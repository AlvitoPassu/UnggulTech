// Test-only approval for a cluster created by createNativePlacementCluster().
// No URLs, dotenv, production configuration or remote connections are read.
import assert from "node:assert/strict";
import { quote } from "./sensorPlacementDatabase.js";

export const CANDIDATE = "20261029_04_sensor_placements_PRODUCTION_CANDIDATE.sql";
export const approvalKey = "unggul.sensor_placements_production_approval";
export const auditKey = "unggul.sensor_placements_reviewed_audit_actions";
export const checkerKey = "unggul.sensor_placements_reviewed_checker_md5";
export const approvalToken = "execute-20261029_04_sensor_placements-PRODUCTION";
export const authSnapshot = `select jsonb_agg(jsonb_build_object('oid',oid,
  'body',pg_get_functiondef(oid),'acl',proacl,'owner',proowner) order by oid) as result
  from pg_proc where proname like 'operator_session_%'`;
export const auditDefinition = `select to_jsonb(pg_get_constraintdef(oid)) as result from pg_constraint
  where conrelid='public.audit_logs'::regclass and conname='audit_logs_action_check'`;

export async function approveLocalCandidate(db) {
  assert.equal(await db.json("select current_setting('server_version_num')::int as result"), 170006);
  const target = await db.json(`select jsonb_build_object('database',current_database(),
    'host',current_setting('listen_addresses'),'checker',md5(pg_get_functiondef(
      'public.operator_session_check(uuid,uuid,text,text)'::regprocedure))) as result`);
  assert.equal(target.host, "127.0.0.1");
  assert.equal(target.database, "postgres");
  const expression = await db.json(auditDefinition);
  const actions = [...expression.matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map(m => m[1]);
  assert.equal(actions.length, 11);
  for (const [key, value] of Object.entries({
    [approvalKey]: approvalToken,
    "unggul.sensor_placements_approval_reference": "SYNTHETIC-LOCAL-TEST-ONLY",
    "unggul.sensor_placements_target_database": target.database,
    [checkerKey]: target.checker,
    [auditKey]: JSON.stringify(actions),
  })) await db.exec(`select set_config(${quote(key)},${quote(value)},false)`);
  return actions;
}
