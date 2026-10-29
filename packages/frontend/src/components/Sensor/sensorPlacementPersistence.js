import { getBedNumber, getLocation, isMapLocation, hasPosition } from "./sensorMapModel.js";
import { draftPosition } from "./sensorPositionDraft.js";

export const isPlacementBigint = (value) => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const sameContext = (a, b) => a?.location === b?.location && a?.bedengan === b?.bedengan;
const contextFor = (sensor) => ({ location: getLocation(sensor), bedengan: getBedNumber(sensor.bedengan) });

export function placementWriteBasis(sensor) {
  if (!sensor || sensor.placementSource !== "db" || !isPlacementBigint(sensor.id)) return null;
  const expectedContext = contextFor(sensor);
  if (!isMapLocation(expectedContext.location) || !expectedContext.bedengan) return null;
  if (sensor.placementState === "unconfigured" && sensor.placement === null) {
    return { sensorId: sensor.id, expectedContext, expectedVersion: null };
  }
  const placement = sensor.placement;
  if (sensor.placementState !== "configured" || !hasPosition(sensor) || placement.sensorId !== sensor.id
    || !isPlacementBigint(placement.version) || !sameContext(placement.context, expectedContext)
    || typeof placement.updatedAt !== "string" || !Number.isFinite(Date.parse(placement.updatedAt))) return null;
  return { sensorId: sensor.id, expectedContext, expectedVersion: placement.version };
}

export function placementPayload(sensor, values) {
  const basis = placementWriteBasis(sensor), position = draftPosition(values || {});
  return basis && position ? { ...position, expectedVersion: basis.expectedVersion, expectedContext: basis.expectedContext } : null;
}

export function placementSaveReason(sensor) {
  if (!sensor) return "Pilih sensor terdaftar dengan sesi operator yang valid.";
  if (sensor.placementSource !== "db") return "Mode JSON hanya mendukung pratinjau. Penyimpanan database belum tersedia.";
  const reasons = {
    invalid: "Data posisi tidak valid. Penyimpanan dinonaktifkan; hubungi pengelola untuk pemeriksaan.",
    context_mismatch: "Lokasi atau bedengan posisi berbeda dari metadata sensor. Periksa data sebelum penempatan ulang.",
    unavailable: "Database posisi belum tersedia. Pratinjau tetap dapat digunakan; penyimpanan dinonaktifkan.",
  };
  return reasons[sensor.placementState] || (placementWriteBasis(sensor) ? "" : "Identitas, versi, atau konteks posisi belum valid untuk disimpan.");
}

export function validatePlacementResult(data, id, payload) {
  const invalid = () => Object.assign(new Error("Hasil penyimpanan belum dapat dikonfirmasi. Baca ulang posisi sebelum mencoba lagi."), { code: "PLACEMENT_RESULT_UNCERTAIN" });
  if (data?.code !== "OK" || data.sensorId !== id || !isPlacementBigint(data.version)
    || typeof data.unchanged !== "boolean" || !sameContext(data.context, payload.expectedContext)
    || data.placement?.row !== payload.row || data.placement?.column !== payload.column
    || !draftPosition({ row: String(data.placement?.row), column: String(data.placement?.column) })
    || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) throw invalid();
  const version = data.unchanged ? payload.expectedVersion
    : payload.expectedVersion === null ? "1" : String(BigInt(payload.expectedVersion) + 1n);
  if (data.version !== version) throw invalid();
  return { sensorId: id, placement: { row: data.placement.row, column: data.placement.column },
    context: { location: data.context.location, bedengan: data.context.bedengan }, version: data.version, updatedAt: data.updatedAt, unchanged: data.unchanged };
}

export function confirmedPlacement(sensor, result) {
  if (!sensor || String(sensor.id) !== result.sensorId || !sameContext(contextFor(sensor), result.context)) return sensor;
  if (isPlacementBigint(sensor.placement?.version) && BigInt(sensor.placement.version) > BigInt(result.version)) return sensor;
  return { ...sensor, placementSource: "db", placementState: "configured", placement: {
    sensorId: result.sensorId, ...result.placement, context: result.context, version: result.version, updatedAt: result.updatedAt,
  } };
}

export function placementErrorMessage(error) {
  const status = error.response?.status, code = error.response?.data?.code;
  if (status === 400) return "Koordinat atau payload ditolak. Periksa Baris 1–10 dan Kolom 1–100.";
  if (status === 401) return "Sesi telah berakhir. Login kembali untuk menyimpan posisi.";
  if (status === 403) return "Akses penyimpanan ditolak. Sesi login tidak dihapus karena penolakan ini.";
  if (status === 404) return "Sensor tidak ditemukan. Muat ulang daftar sensor.";
  if (status === 409) return ({
    PLACEMENT_OCCUPIED: "Titik sudah ditempati sensor lain. Pilih posisi lain dan tinjau kembali.",
    PLACEMENT_VERSION_CONFLICT: "Versi posisi telah berubah. Muat posisi terbaru dan tinjau kembali.",
    SENSOR_CONTEXT_CHANGED: "Lokasi atau bedengan sensor telah berubah. Muat posisi terbaru dan periksa metadata.",
    SENSOR_CONTEXT_INCOMPLETE: "Metadata lokasi atau bedengan sensor belum lengkap.",
  })[code] || "Posisi berkonflik dengan data terbaru. Periksa kembali sebelum menyimpan.";
  if (status === 503 && code === "SENSOR_PLACEMENT_WRITE_DISABLED") return "Penyimpanan posisi belum diaktifkan oleh backend. Pratinjau tetap tersedia.";
  if (status === 503 && code === "SENSOR_PLACEMENT_READ_NOT_READY") return "Sumber baca database belum siap. Posisi tidak disimpan.";
  return "Status penyimpanan belum pasti. Baca ulang posisi sebelum mencoba lagi; request tidak diulang otomatis.";
}

// Registry/request lifecycle only. Authentication stays in AuthContext and Axios.
export class SensorPlacementRegistry {
  constructor({ read, write }) {
    Object.assign(this, { read, write });
    this.view = { sensors: [], loading: true, error: false, operations: {} };
    this.listeners = new Set(); this.revision = 0; this.active = false; this.floors = new Map();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(update) { this.view = { ...this.view, ...update }; for (const listener of this.listeners) listener(this.view); }
  operation(id, value) { this.publish({ operations: { ...this.view.operations, [id]: value } }); }
  activate() { this.active = true; }
  deactivate() { this.active = false; this.revision++; }
  remember(sensor) {
    if (!placementWriteBasis(sensor) || sensor.placementState !== "configured") return;
    const previous = this.floors.get(sensor.id);
    if (!previous || BigInt(sensor.placement.version) > BigInt(previous.version)) this.floors.set(sensor.id, {
      sensorId: sensor.id, placement: { row: sensor.placement.row, column: sensor.placement.column },
      context: sensor.placement.context, version: sensor.placement.version, updatedAt: sensor.placement.updatedAt,
    });
  }
  async refresh() {
    const revision = ++this.revision;
    try {
      const incoming = await this.read();
      if (!this.active || revision !== this.revision) return false;
      if (!Array.isArray(incoming)) throw new Error("Invalid registry response");
      const sensors = incoming.map((sensor) => {
        const floor = this.floors.get(String(sensor.id));
        if (floor && sensor.placementSource === "db" && sameContext(contextFor(sensor), floor.context)
          && (sensor.placementState === "unconfigured" || (placementWriteBasis(sensor)
            && BigInt(sensor.placement.version) < BigInt(floor.version)))) {
          // Retain the confirmed marker/version, but block writes until a fresh read catches up.
          return { ...confirmedPlacement(sensor, floor), placementState: "unavailable" };
        }
        this.remember(sensor); return sensor;
      });
      const operations = { ...this.view.operations };
      for (const [id, operation] of Object.entries(operations)) {
        if (operation.state === "needs_read" && placementWriteBasis(sensors.find((sensor) => sensor.id === id))) {
          operations[id] = { state: operation.confirmed ? "success" : "warning", message: operation.confirmed
            ? "Posisi sensor berhasil disimpan dan dibaca ulang."
            : "Posisi sudah dibaca ulang. Hasil request sebelumnya belum pasti; tinjau data sebelum mencoba lagi." };
        }
      }
      this.publish({ sensors, operations, loading: false, error: false });
      return true;
    } catch {
      if (this.active && revision === this.revision) this.publish({ loading: false, error: true });
      return false;
    }
  }
  async save(id, payload) {
    const sensor = this.view.sensors.find((item) => item.id === id), operation = this.view.operations[id];
    const candidate = placementPayload(sensor, { row: String(payload.row), column: String(payload.column) });
    if (!this.active || this.view.error || ["saving", "checking", "needs_read"].includes(operation?.state)
      || !candidate || candidate.row !== payload.row || candidate.column !== payload.column
      || JSON.stringify(placementWriteBasis(sensor)) !== JSON.stringify({ sensorId: id, expectedContext: payload.expectedContext, expectedVersion: payload.expectedVersion })) {
      throw new Error("Data posisi belum siap atau telah berubah. Muat posisi terbaru.");
    }
    this.revision++; // Invalidate any GET that began before this mutation.
    this.operation(id, { state: "saving", message: "Menyimpan posisi sensor…" });
    let result;
    try {
      result = await this.write(id, payload);
    } catch (error) {
      if (!this.active) throw error;
      const status = error.response?.status, code = error.response?.data?.code;
      const uncertain = !status || status >= 500 && !["SENSOR_PLACEMENT_WRITE_DISABLED", "SENSOR_PLACEMENT_READ_NOT_READY"].includes(code);
      this.operation(id, { state: uncertain ? "needs_read" : "error", message: placementErrorMessage(error) });
      // Reconcile ambiguity/conflicts with GET only. Never replay PUT.
      if (uncertain || status === 409 || status === 404) await this.refresh();
      throw error;
    }
    if (!this.active) return result;
    this.revision++;
    const updated = this.view.sensors.map((sensor) => confirmedPlacement(sensor, result));
    updated.forEach((sensor) => this.remember(sensor));
    this.publish({ sensors: updated });
    this.operation(id, { state: "checking", message: "Posisi dikonfirmasi server. Memperbarui peta…" });
    await this.refresh();
    if (this.active) {
      const current = this.view.sensors.find((sensor) => sensor.id === id);
      const ready = !this.view.error && placementWriteBasis(current) && current.placementState === "configured"
        && BigInt(current.placement.version) >= BigInt(result.version);
      this.operation(id, ready ? { state: "success", message: "Posisi sensor berhasil disimpan." }
        : { state: "needs_read", confirmed: true, message: "Posisi telah dikonfirmasi server, tetapi pembacaan ulang belum siap. Periksa posisi sebelum menyimpan lagi." });
    }
    return result;
  }
}
