import { useState } from "react";
import { FiMapPin } from "react-icons/fi";
import HeaderAuthStatus from "../components/Auth/HeaderAuthStatus";
import { useAuth } from "../context/AuthContext";
import NurseryMap from "../components/Sensor/NurseryMap";
import BedMap from "../components/Sensor/BedMap";
import SensorReadings from "../components/Sensor/SensorReadings";
import useSensorMonitoring from "../components/Sensor/useSensorMonitoring";
import { isOutsideMap, sensorsForBed } from "../components/Sensor/sensorMapModel";
import "../components/Sensor/sensorMap.css";

const panelClass = "min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6";

export default function SensorPage() {
  const { isAuthenticated, secondsRemaining, openLoginModal, executeProtectedAction, sessionId } = useAuth();
  const [selection, setSelection] = useState({ bed: 1, sensorId: "" });
  const { registry, readings, ph, location, selectedSensor, selectedSensorId, savePlacement, refreshRegistry } = useSensorMonitoring(selection);
  const savePosition = (id, payload, isCurrent) => executeProtectedAction(async () => {
    if (!isCurrent()) return null;
    try { return await savePlacement(id, payload); }
    catch (error) {
      if (error.response?.status === 401) openLoginModal();
      throw error;
    }
  });
  const bedSensors = sensorsForBed(registry.sensors, location, selection.bed);
  const unassigned = registry.sensors.filter((sensor) => isOutsideMap(sensor, location));
  const chooseBed = (bed) => setSelection((previous) => previous.bed === bed && !previous.sensorId ? previous : { bed, sensorId: "" });

  return <div className="sensor-page min-h-screen min-w-0 bg-[#F5F6F8] text-slate-800">
    <header className="sticky top-0 z-30 h-[73px] border-b border-[#1686b3] bg-[#1DAADF] text-white shadow-sm">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3"><img src="/apple-touch-icon.png" alt="" className="h-10 w-10 rounded-lg bg-white/15 object-contain" />
          <div className="min-w-0"><p className="truncate text-sm font-semibold sm:text-base">Smart Soil Monitoring System</p><p className="mt-0.5 text-xs text-white/80">Pemetaan &amp; monitoring sensor</p></div></div>
        <HeaderAuthStatus />
      </div>
    </header>
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 pb-28 sm:px-8 sm:py-7 sm:pb-28">
      <div className="mb-6"><p className="mb-1 text-sm font-medium text-[#1DAADF]">Sensor / Pemetaan Bedengan</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Sensor</h1></div>
      <section className={panelClass} aria-labelledby="nursery-map-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="nursery-map-title" className="text-lg font-bold text-slate-900">Peta bedengan</h2><p className="mt-1 text-sm text-slate-500">Pilih bedengan untuk melihat penempatan sensor.</p></div><span className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">60 bedengan · 6 × 10</span></div>
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><FiMapPin className="shrink-0" aria-hidden="true" /><span className="break-words">{location || "Lokasi bibitan belum tercatat"}</span></p>
        {registry.loading && <p role="status" className="mt-4 text-sm text-slate-500">Memuat daftar sensor…</p>}
        {registry.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">Daftar sensor gagal diperbarui. Pemetaan terakhir mungkin tidak mutakhir. Sistem mencoba kembali setiap 60 detik.</p>}
        {!registry.loading && !registry.error && registry.sensors.length === 0 && <p role="status" className="mt-4 text-sm text-slate-500">Belum ada sensor terdaftar. Grid berikut adalah representasi layout.</p>}
        <NurseryMap sensors={registry.sensors} location={location} selectedBed={selection.bed} onSelect={chooseBed} />
        <p className="mt-3 text-xs leading-5 text-slate-500">Layout awal bibitan · Garis abu-abu menunjukkan jalur pipa dan sumisamsuwi. Titik biru kecil menandai bedengan dengan sensor terdaftar.</p>
      </section>

      <div className="mt-6 min-w-0 space-y-6">
        <section className={panelClass} aria-label="Detail bedengan terpilih">
          {selection.bed ? <BedMap key={`${location}:${selection.bed}`} bed={selection.bed} sensors={bedSensors} selectedSensorId={selectedSensorId}
            canEditPosition={isAuthenticated && secondsRemaining > 0}
            onRequestPositionLogin={!isAuthenticated ? () => openLoginModal() : undefined}
            editorSessionKey={sessionId} onSavePosition={savePosition} onRefreshPosition={refreshRegistry}
            placementOperation={registry.operations?.[selectedSensorId]}
            registryState={registry.loading ? "loading" : registry.error ? "error" : "ready"}
            onSelect={(sensorId) => setSelection((previous) => previous.sensorId === sensorId ? previous : { bed: previous.bed, sensorId })} />
            : <p className="text-sm text-slate-500">Sensor ini berada di luar lokasi atau layout peta B1–B60. Pilih bedengan pada peta untuk melanjutkan.</p>}
        </section>

        <section className={panelClass} aria-label="Informasi sensor dan pengukuran global">
          <SensorReadings sensor={selectedSensor} readings={readings} ph={ph} unavailable={registry.error} />
        </section>
        {unassigned.length > 0 && <details className={panelClass}><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-600">Sensor di luar peta ({unassigned.length})</summary><p className="mt-1 text-xs text-slate-500">Lokasi atau nomor bedengan belum sesuai dengan peta ini. Monitoring hanya tersedia untuk sensor pada bedengan aktif.</p><ul className="mt-3 flex flex-wrap gap-2">{unassigned.map((sensor) => <li key={sensor.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">{sensor.sensor_name || `Sensor ${sensor.id}`}</li>)}</ul></details>}
      </div>
    </main>
  </div>;
}
