import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

test("Sensor page immediately renders 60 beds without nursery controls even with legacy multiple locations", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    plugins: [{
      name: "sensor-page-test-dependencies",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("/useSensorMonitoring")) return "\0test-monitoring";
        if (source.endsWith("/HeaderAuthStatus")) return "\0test-header";
        if (source.endsWith("/AuthContext")) return "\0test-auth";
      },
      load(id) {
        if (id === "\0test-header") return "export default () => null";
        if (id === "\0test-auth") return "export const useAuth = () => ({ isAuthenticated: false, secondsRemaining: 0 })";
        if (id === "\0test-monitoring") return `export default () => ({
          registry: { sensors: [
            { id: 701, location: 'Lokasi sebenarnya', bedengan: '1', placement: null },
            { id: 991, location: 'Lokasi lain', bedengan: '1', placement: null },
            { id: 992, location: null, bedengan: '2', placement: null }
          ], loading: false, error: false },
          location: 'Lokasi sebenarnya', readings: {}, ph: {}, selectedSensorId: ''
        })`;
      },
    }, react()], server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    const { default: SensorPage } = await vite.ssrLoadModule("/src/pages/SensorPage.jsx");
    const page = renderToStaticMarkup(createElement(SensorPage));
    assert.equal((page.match(/aria-label="Bedengan \d+,/g) || []).length, 60);
    assert.match(page, /grid-cols-6/);
    assert.match(page, /aria-pressed="true" aria-label="Bedengan 1, 1 sensor/);
    assert.match(page, /Lokasi sebenarnya/);
    assert.doesNotMatch(page, /Pilih lokasi bibitan|<select|role="combobox"|role="tab"|Lokasi lain/);
    assert.match(page, /Posisi belum dikonfigurasi/);
    assert.match(page, /Sensor di luar peta \(2\)/);
    assert.match(page, /Sensor 991/);
    assert.match(page, /Sensor 992/);
    assert.doesNotMatch(page, /class="sensor-marker/);
    assert.match(page, /Pilih sensor pada peta bedengan untuk melihat grafik monitoring dan pembacaan terbaru\./);
    assert.doesNotMatch(page, /aria-label="Grafik Monitoring"|aria-label="Pembacaan Terbaru"|Pengukuran Global/);
  } finally { await vite.close(); }
});

test("rendered mapping exposes real markers, empty/error states and global pH separately", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    const { default: NurseryMap } = await vite.ssrLoadModule("/src/components/Sensor/NurseryMap.jsx");
    const { default: BedMap } = await vite.ssrLoadModule("/src/components/Sensor/BedMap.jsx");
    const { default: SensorReadings } = await vite.ssrLoadModule("/src/components/Sensor/SensorReadings.jsx");
    const sensor = { id: 701, sensor_name: "Sensor uji", location: "Nursery pengujian", bedengan: 1, placement: { row: 6, column: 10 } };
    const nullSensors = Array.from({ length: 6 }, (_, i) => ({ ...sensor, id: String(i + 1), location: null, bedengan: i + 1 }));
    const nullNursery = renderToStaticMarkup(createElement(NurseryMap, { sensors: nullSensors, location: null, selectedBed: 1 }));
    for (let bed = 1; bed <= 6; bed++) assert.match(nullNursery, new RegExp(`aria-label="Bedengan ${bed}, 1 sensor`));
    const nullBed = renderToStaticMarkup(createElement(BedMap, { bed: 1, sensors: [nullSensors[0]], selectedSensorId: "1", canEditPosition: true }));
    assert.match(nullBed, /aria-label="Sensor 1, baris 6, kolom 10"/);
    assert.doesNotMatch(nullBed, /disabled=""[^>]*>Atur Posisi Sensor/);
    const sensors = [sensor, { ...sensor, id: 702, placement: null }];
    const nursery = renderToStaticMarkup(createElement(NurseryMap, { sensors, location: sensor.location, selectedBed: 1 }));
    assert.equal((nursery.match(/aria-label="Bedengan \d+,/g) || []).length, 60);
    assert.match(nursery, /aria-pressed="true" aria-label="Bedengan 1, 2 sensor/);
    const bed = renderToStaticMarkup(createElement(BedMap, { bed: 1, sensors, selectedSensorId: "701" }));
    assert.equal((bed.match(/data-seedling="true"/g) || []).length, 1000);
    assert.match(bed, /aria-label="Sensor 701, baris 6, kolom 10" aria-pressed="true"/);
    assert.doesNotMatch(bed, /aria-label="Sensor 702,/);
    assert.match(bed, /Posisi belum dikonfigurasi/);
    assert.match(bed, /Representasi 1.000 bibit, 10 baris dan 100 kolom/);
    assert.match(bed, /disabled=""[^>]*>Atur Posisi Sensor/);
    for (const [canEditPosition, selectedSensorId, registryState, allowed] of [
      [false, "701", "ready", false], [true, "701", "ready", true],
      [true, "702", "ready", true], [true, "999", "ready", false],
      [true, "701", "error", false], [true, "701", "loading", false],
    ]) {
      const markup = renderToStaticMarkup(createElement(BedMap, { bed: 1, sensors, selectedSensorId, canEditPosition, registryState }));
      assert.equal(/disabled=""[^>]*>Atur Posisi Sensor/.test(markup), !allowed);
      assert.doesNotMatch(markup, /sensor-position-preview|<form/);
    }
    // A public viewer can open the existing login flow, but never receives an editor.
    for (const [selectedSensorId, registryState, loginAvailable] of [
      ["701", "ready", true], ["702", "ready", true], ["999", "ready", false],
      ["701", "error", false], ["701", "loading", false],
    ]) {
      const markup = renderToStaticMarkup(createElement(BedMap, { bed: 1, sensors, selectedSensorId,
        registryState, canEditPosition: false, onRequestPositionLogin: () => {} }));
      assert.equal(/disabled=""[^>]*>Atur Posisi Sensor/.test(markup), !loginAvailable);
      assert.doesNotMatch(markup, /sensor-position-preview|<form/);
    }
    const corners = [[1, 1], [1, 100], [10, 1], [10, 100]].map(([row, column], index) => ({ ...sensor, id: 710 + index, placement: { row, column } }));
    const invalid = [
      { row: 0, column: 1 }, { row: -1, column: 1 }, { row: 11, column: 1 },
      { row: 1, column: 0 }, { row: 1, column: -1 }, { row: 1, column: 101 },
      { row: 1.5, column: 1 }, { row: 1, column: 1.5 }, { row: "1", column: 1 }, { row: 1, column: "abc" },
    ].map((placement, index) => ({ ...sensor, id: 720 + index, sensor_name: `Sensor ${720 + index}`, placement }));
    const cornerMap = renderToStaticMarkup(createElement(BedMap, { bed: 1, sensors: [...corners, ...invalid], selectedSensorId: "713" }));
    assert.equal((cornerMap.match(/class="sensor-marker/g) || []).length, 4);
    assert.equal((cornerMap.match(/data-seedling="true"/g) || []).length, 1000);
    assert.equal((cornerMap.match(/aria-pressed="(?:true|false)"/g) || []).length, 4 + corners.length + invalid.length);
    for (const item of corners) assert.ok(cornerMap.includes(`aria-label="Sensor ${item.id}, baris ${item.placement.row}, kolom ${item.placement.column}"`));
    for (const item of invalid) {
      assert.ok(cornerMap.includes(`Sensor ${item.id}`), "Invalid positions remain selectable in the existing list");
      assert.ok(!cornerMap.includes(`aria-label="Sensor ${item.id},`));
    }
    assert.match(cornerMap, /aria-label="Sensor 713, baris 10, kolom 100" aria-pressed="true"/);
    const empty = renderToStaticMarkup(createElement(BedMap, { bed: 60, sensors: [] }));
    assert.match(empty, /Belum ada sensor yang terpasang pada bedengan ini/);
    for (const registryState of ["loading", "error"]) {
      const unavailable = renderToStaticMarkup(createElement(BedMap, { bed: 60, sensors: [], registryState }));
      assert.doesNotMatch(unavailable, /Belum ada sensor yang terpasang/);
    }
    const detail = renderToStaticMarkup(createElement(SensorReadings, {
      sensor, readings: { sensorId: "701", data: { moisture: 0, sensorHealth: "stale", condition: "dry", temperature: null, humidity: null, lastSeen: "2026-10-27T00:00:00Z" } },
      ph: { data: { soilPh: 6.4, status: "active", measuredAt: "2026-10-27T00:00:00Z" }, history: [] },
    }));
    assert.match(detail, /0%/);
    assert.match(detail, /Stale/);
    assert.match(detail, /pH Tanah — Pengukuran Global/);
    assert.match(detail, /08[.:]00[.:]00 WITA/);
    assert.doesNotMatch(detail, /Suhu udara \(DHT11/);
    const error = renderToStaticMarkup(createElement(SensorReadings, {
      sensor, readings: { sensorId: "701", error: true }, ph: { error: true },
    }));
    assert.match(error, /Data sensor gagal dimuat/);
    assert.doesNotMatch(error, /Offline|0%/);
    const previous = renderToStaticMarkup(createElement(SensorReadings, {
      sensor: { ...sensor, id: 703 }, readings: { sensorId: "701", data: { moisture: 55 } }, ph: {},
    }));
    assert.match(previous, /Memuat pembacaan sensor/);
    assert.doesNotMatch(previous, /55%/);
    const cached = {
      sensorId: "701", data: { moisture: 55, temperature: 27, chart: [{ time: "08:00", moisture: 55 }] },
      logs: [{ id: 1, moisture: 55, temperature: 27, time: "Pembacaan lama" }],
    };
    for (const readings of [{ ...cached, loading: true }, { ...cached, sensorId: "702" }]) {
      const pending = renderToStaticMarkup(createElement(SensorReadings, { sensor, readings, ph: {} }));
      assert.match(pending, /Memuat pembacaan sensor/);
      assert.match(pending, /Memuat grafik sensor/);
      assert.doesNotMatch(pending, /55%|27°C|Pembacaan lama|<table/);
    }
    const unselected = renderToStaticMarkup(createElement(SensorReadings, {
      readings: cached, ph: { data: { soilPh: 6.4 }, history: [{ soilPh: 6.4 }] },
    }));
    assert.match(unselected, /Pilih sensor pada peta bedengan/);
    assert.doesNotMatch(unselected, /55%|6\.40|Grafik Monitoring|Pembacaan Terbaru|<table/);
    assert.ok(detail.indexOf('aria-label="Pembacaan Terbaru"') < detail.indexOf('aria-label="Grafik Monitoring"'));
    assert.match(detail, /Belum ada data terbaru/);
    assert.match(detail, /Data grafik belum tersedia/);
  } finally { await vite.close(); }
});
