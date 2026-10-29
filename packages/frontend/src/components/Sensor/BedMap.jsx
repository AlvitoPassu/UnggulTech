import { memo, useRef, useState } from "react";
import { FiMaximize, FiMinus, FiPlus } from "react-icons/fi";
import { BED_MAP_HEIGHT, BED_MAP_WIDTH, getBedNumber, getLocation, isMapLocation, hasPosition, pointCoordinates, SEEDLING_COLUMNS, SEEDLING_POINTS, SEEDLING_ROWS } from "./sensorMapModel";
import SensorPositionEditor from "./SensorPositionEditor";

const Seedlings = memo(function Seedlings({ onPick }) {
  return <g fill="#cbd5e1" aria-hidden="true" className={onPick ? "cursor-crosshair" : undefined}>{SEEDLING_POINTS.map((point, index) => {
    const { x, y } = pointCoordinates(point);
    return <circle key={index} cx={x} cy={y} r="2.7" data-seedling="true" onClick={onPick ? () => onPick(point) : undefined} />;
  })}</g>;
});

export default function BedMap({ bed, sensors, selectedSensorId, onSelect, registryState = "ready", canEditPosition = false,
  onRequestPositionLogin, onSavePosition, onRefreshPosition, placementOperation, editorSessionKey = "" }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef(null);
  const placed = sensors.filter(hasPosition);
  const selectedSensor = sensors.find((sensor) => String(sensor.id) === String(selectedSensorId) && getBedNumber(sensor.bedengan) === bed && isMapLocation(getLocation(sensor)));
  const editableSensor = canEditPosition && registryState === "ready" ? selectedSensor : null;
  const disabledReason = !canEditPosition ? "Sesi operator aktif diperlukan untuk mengatur posisi sensor."
    : registryState !== "ready" ? "Tunggu daftar sensor berhasil dimuat sebelum mengatur posisi."
      : "Pilih sensor terdaftar pada bedengan ini terlebih dahulu.";
  const fitView = () => {
    setZoom(1);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };
  return <>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-slate-900">Bedengan {bed}</h2>
        <p className="mt-1 text-sm text-slate-500">Pilih titik sensor untuk melihat informasi detail.</p></div>
      <div className="flex gap-1" role="group" aria-label="Atur tampilan bedengan">
        <button type="button" className="map-control" aria-label="Perkecil bedengan" disabled={zoom === 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}><FiMinus /></button>
        <button type="button" className="map-control" aria-label="Perbesar bedengan" disabled={zoom === 3} onClick={() => setZoom((value) => Math.min(3, value + 0.5))}><FiPlus /></button>
        <button type="button" className="map-control gap-2 px-3" onClick={fitView}><FiMaximize aria-hidden="true" /> Fit View</button>
      </div>
    </div>
    <SensorPositionEditor key={`${bed}:${selectedSensorId}:${Boolean(editableSensor)}:${editorSessionKey}`} sensor={editableSensor} statusSensor={selectedSensor} disabledReason={disabledReason}
      onSavePosition={onSavePosition} onRefreshPosition={onRefreshPosition} operation={placementOperation}
      onRequestLogin={!canEditPosition && registryState === "ready" && selectedSensor ? onRequestPositionLogin : undefined}
      renderMap={({ editing, position, onPick }) => <div ref={viewport} className="bed-viewport overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3" tabIndex={0} aria-label="Visualisasi bedengan; geser untuk melihat area yang diperbesar">
      <div className="relative" style={{ width: `${zoom * 100}%`, minWidth: 300 }}>
        <svg viewBox={`0 0 ${BED_MAP_WIDTH} ${BED_MAP_HEIGHT}`} className="block w-full" role="img" aria-label={`Representasi 1.000 bibit, ${SEEDLING_ROWS} baris dan ${SEEDLING_COLUMNS} kolom`}>
          <rect x="25" y="26" width="830" height="386" rx="12" fill="white" stroke="#cbd5e1" />
          <Seedlings onPick={onPick} />
          <g fill="#64748b" fontSize="10" textAnchor="middle" aria-hidden="true">
            {Array.from({ length: SEEDLING_ROWS }, (_, index) => <text key={`row-${index}`} x="45" y={pointCoordinates({ row: index + 1, column: 1 }).y} dominantBaseline="middle">{index + 1}</text>)}
            {[1, ...Array.from({ length: SEEDLING_COLUMNS / 10 }, (_, index) => (index + 1) * 10)].map((column) => <text key={`column-${column}`} x={pointCoordinates({ row: 1, column }).x} y="47">{column}</text>)}
          </g>
          <path d="M20 18 H861 V420 H20" fill="none" stroke="#94a3b8" strokeWidth="3" />
          {Array.from({ length: 8 }, (_, index) => <path key={index} d={`M${70 + index * 105} 18 v-8 m-5 0 h10 M${70 + index * 105} 420 v8 m-5 0 h10`} stroke="#94a3b8" fill="none" strokeWidth="2" />)}
        </svg>
        {placed.map((sensor) => {
          const { x, y } = pointCoordinates(sensor.placement);
          const selected = String(sensor.id) === String(selectedSensorId);
          return <button key={sensor.id} type="button" onClick={() => onSelect(String(sensor.id))}
            aria-label={`Sensor ${sensor.id}, baris ${sensor.placement.row}, kolom ${sensor.placement.column}`} aria-pressed={selected}
            title={`${sensor.sensor_name || `Sensor ${sensor.id}`} · Baris ${sensor.placement.row}, kolom ${sensor.placement.column}`}
            className={`sensor-marker absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ${selected ? "text-white" : "text-slate-600"}`}
            style={{ left: `${x / BED_MAP_WIDTH * 100}%`, top: `${y / BED_MAP_HEIGHT * 100}%` }}>
            <span className={`flex h-7 min-w-7 items-center justify-center rounded-full border-2 px-1 text-[10px] font-bold shadow-sm ${selected ? "border-white bg-[#1DAADF] ring-2 ring-[#1DAADF]" : "border-white bg-slate-200 ring-2 ring-slate-500"}`}>{sensor.id}</span>
          </button>;
        })}
        {editing && position && <div className="sensor-position-preview pointer-events-none absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center" role="img"
          aria-label={`Pratinjau Sensor ${editableSensor.id}, baris ${position.row}, kolom ${position.column}; belum disimpan`}
          style={{ left: `${pointCoordinates(position).x / BED_MAP_WIDTH * 100}%`, top: `${pointCoordinates(position).y / BED_MAP_HEIGHT * 100}%` }}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-amber-700 bg-amber-100 text-[10px] font-bold text-amber-900">{editableSensor.id}</span>
        </div>}
      </div>
    </div>} />
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>Kapasitas 1.000 bibit</span><span>{placed.length} sensor dipetakan · {sensors.length} terdaftar</span></div>
    <p className="mt-2 text-xs leading-5 text-slate-500">Susunan {SEEDLING_ROWS} baris × {SEEDLING_COLUMNS} kolom adalah representasi visual. Garis sisi menunjukkan jalur sumisamsuwi. Posisi marker mengikuti konfigurasi pemasangan.</p>
    {registryState === "loading" && <p role="status" className="mt-5 text-sm text-slate-500">Memuat data penempatan sensor…</p>}
    {registryState === "ready" && sensors.length === 0 && <p role="status" className="mt-5 rounded-md bg-slate-50 p-4 text-sm text-slate-500">Belum ada sensor yang terpasang pada bedengan ini.</p>}
    {sensors.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="mb-3 text-xs font-semibold text-slate-500">Sensor terdaftar pada bedengan ini</p>
      <div className="flex flex-wrap gap-2">{sensors.map((sensor) => <button type="button" key={sensor.id}
        onClick={() => onSelect(String(sensor.id))} aria-pressed={String(sensor.id) === String(selectedSensorId)}
        className={`min-h-11 rounded-md border px-3 py-2 text-left text-xs ${String(sensor.id) === String(selectedSensorId) ? "border-[#1DAADF] bg-sky-50 text-[#1686b3]" : "border-slate-200 text-slate-600"}`}>
        {sensor.sensor_name || `Sensor ${sensor.id}`}<span className="mt-1 block text-[11px]">{hasPosition(sensor) ? `Baris ${sensor.placement.row}, kolom ${sensor.placement.column}` : "Posisi belum dikonfigurasi"}</span>
      </button>)}</div>
    </div>}
  </>;
}
