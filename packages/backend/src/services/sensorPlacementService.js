import { supabase } from "../config/supabase.js";
import { isSensorPlacementWriteEnabled } from "../config/sensorPlacementWrite.js";
import { SessionError } from "../middleware/authMiddleware.js";
import { isPositiveBigintString, isPlacementLocation } from "../domain/sensorPlacement.js";
import { isSensorPlacementReadReady } from "./sensorPlacementReadService.js";
import { getSensorPlacementReadSource } from "../config/sensorPlacementRead.js";

export { isPositiveBigintString } from "../domain/sensorPlacement.js";

const errors = {
  SENSOR_PLACEMENT_WRITE_DISABLED: [503, "Penyimpanan posisi sensor belum diaktifkan."],
  SENSOR_PLACEMENT_READ_NOT_READY: [503, "Sumber pembacaan posisi database belum aktif atau belum siap. Posisi tidak disimpan."],
  INVALID_SENSOR_ID: [400, "Sensor ID harus berupa string bilangan bulat positif dalam rentang bigint."],
  INVALID_PLACEMENT: [400, "Payload posisi tidak valid. Gunakan Baris 1–10 dan Kolom 1–100 berupa JSON number bilangan bulat serta konteks sensor yang lengkap."],
  INVALID_EXPECTED_VERSION: [400, "expectedVersion wajib null untuk posisi pertama atau string bigint positif untuk pembaruan."],
  SENSOR_NOT_FOUND: [404, "Sensor tidak terdaftar."],
  SENSOR_CONTEXT_INCOMPLETE: [409, "Lokasi atau bedengan sensor belum valid. Periksa metadata sensor terlebih dahulu."],
  SENSOR_CONTEXT_CHANGED: [409, "Lokasi atau bedengan sensor telah berubah. Muat ulang data sensor sebelum mencoba kembali."],
  PLACEMENT_OCCUPIED: [409, "Titik tersebut sudah ditempati sensor lain pada lokasi dan bedengan yang sama."],
  PLACEMENT_VERSION_CONFLICT: [409, "Posisi sensor telah berubah. Gunakan versi terbaru sebelum menyimpan kembali."],
  PLACEMENT_VERSION_EXHAUSTED: [409, "Versi posisi sensor mencapai batas. Hubungi pengelola."],
  PLACEMENT_ACCESS_DENIED: [403, "Akses penyimpanan posisi sensor tidak diizinkan."],
  PLACEMENT_DATABASE_UNAVAILABLE: [503, "Layanan penyimpanan posisi belum tersedia atau hasil penyimpanan belum dapat dikonfirmasi."],
  PLACEMENT_INTERNAL_ERROR: [500, "Terjadi kesalahan saat memproses penyimpanan posisi sensor."],
};
const rpcSessionCodes = new Set(["INVALID_SESSION", "SESSION_NOT_FOUND", "SESSION_MISMATCH", "SESSION_TIMEOUT"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const integerIn = (value, maximum) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maximum;

export class SensorPlacementError extends Error {
  constructor(code) {
    const [statusCode, message] = errors[code] || errors.PLACEMENT_INTERNAL_ERROR;
    super(message);
    this.code = Object.hasOwn(errors, code) ? code : "PLACEMENT_INTERNAL_ERROR";
    this.statusCode = statusCode;
  }
}

export function validateSensorPlacementRequest(sensorId, body) {
  if (!isPositiveBigintString(sensorId)) throw new SensorPlacementError("INVALID_SENSOR_ID");
  if (!exactKeys(body, ["row", "column", "expectedVersion", "expectedContext"])
    || !integerIn(body.row, 10) || !integerIn(body.column, 100)
    || !exactKeys(body.expectedContext, ["location", "bedengan"])
    || !isPlacementLocation(body.expectedContext.location)
    || !integerIn(body.expectedContext.bedengan, 60)) {
    throw new SensorPlacementError("INVALID_PLACEMENT");
  }
  if (body.expectedVersion !== null && !isPositiveBigintString(body.expectedVersion)) {
    throw new SensorPlacementError("INVALID_EXPECTED_VERSION");
  }
  // Allowlist the outbound payload. Identity, timestamps and metadata cannot be supplied by the client.
  return { row: body.row, column: body.column, expectedVersion: body.expectedVersion,
    expectedContext: { location: body.expectedContext.location, bedengan: body.expectedContext.bedengan } };
}

function databaseError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "42501") return new SensorPlacementError("PLACEMENT_ACCESS_DENIED");
  if (code === "23505" && ["sensor_placements_point_key", "sensor_placements_null_point_key"].includes(error.constraint)) {
    return new SensorPlacementError("PLACEMENT_OCCUPIED");
  }
  if (!code || code.startsWith("PGRST") || /^(08|22|23|40|42|53|55|57|58)/.test(code)
    || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code)) {
    return new SensorPlacementError("PLACEMENT_DATABASE_UNAVAILABLE");
  }
  // Unknown SQLSTATE/exception: never expose raw message, details, hint or credentials.
  return new SensorPlacementError("PLACEMENT_INTERNAL_ERROR");
}

function savedPosition(data, sensorId, request) {
  if (!object(data) || data.sensorId !== sensorId || !object(data.placement) || !object(data.context)
    || !integerIn(data.placement.row, 10) || !integerIn(data.placement.column, 100)
    || data.placement.row !== request.row || data.placement.column !== request.column
    || data.context.location !== request.expectedContext.location || data.context.bedengan !== request.expectedContext.bedengan
    || !isPositiveBigintString(data.version) || typeof data.updatedAt !== "string"
    || !Number.isFinite(Date.parse(data.updatedAt)) || typeof data.unchanged !== "boolean") {
    throw new SensorPlacementError("PLACEMENT_DATABASE_UNAVAILABLE");
  }
  const expectedVersion = data.unchanged ? request.expectedVersion
    : request.expectedVersion === null ? "1" : String(BigInt(request.expectedVersion) + 1n);
  if (data.version !== expectedVersion) throw new SensorPlacementError("PLACEMENT_DATABASE_UNAVAILABLE");
  // Only the public write-result contract is returned, even if a faulty RPC adds private fields.
  return { sensorId: data.sensorId, placement: { row: data.placement.row, column: data.placement.column },
    context: { location: data.context.location, bedengan: data.context.bedengan },
    version: data.version, updatedAt: new Date(data.updatedAt).toISOString(), unchanged: data.unchanged };
}

export async function saveSensorPlacement(sensorId, body, operatorIdentity) {
  // Recheck after async middleware; direct service callers cannot bypass the feature gate.
  if (!isSensorPlacementWriteEnabled()) throw new SensorPlacementError("SENSOR_PLACEMENT_WRITE_DISABLED");
  if (!operatorIdentity?.user?.id || !operatorIdentity.authSessionId || !operatorIdentity.sessionHash) {
    throw new SessionError("INVALID_SESSION");
  }
  const request = validateSensorPlacementRequest(sensorId, body);
  if (!await isSensorPlacementReadReady(sensorId) || getSensorPlacementReadSource() !== "db") {
    throw new SensorPlacementError("SENSOR_PLACEMENT_READ_NOT_READY");
  }
  // Readiness adds an async boundary; do not use a stale write flag after the probe.
  if (!isSensorPlacementWriteEnabled()) throw new SensorPlacementError("SENSOR_PLACEMENT_WRITE_DISABLED");
  let result;
  try {
    result = await supabase.rpc("sensor_placement_save", {
      p_user_id: operatorIdentity.user.id,
      p_auth_session_id: operatorIdentity.authSessionId,
      p_app_session_hash: operatorIdentity.sessionHash,
      p_sensor_id: sensorId,
      p_payload: request,
    });
  } catch (error) { throw databaseError(error); }
  if (!result || result.error) throw databaseError(result?.error);
  const data = result.data;
  if (!object(data) || typeof data.code !== "string") throw new SensorPlacementError("PLACEMENT_DATABASE_UNAVAILABLE");
  if (rpcSessionCodes.has(data.code)) throw new SessionError(data.code);
  if (data.code !== "OK") {
    throw new SensorPlacementError(Object.hasOwn(errors, data.code) ? data.code : "PLACEMENT_DATABASE_UNAVAILABLE");
  }
  return savedPosition(data, sensorId, request);
}
