import { useEffect, useId, useRef, useState } from "react";
import { FiMinus, FiPlus } from "react-icons/fi";
import { hasPosition } from "./sensorMapModel";
import { coordinateMaximum, draftPosition, parseDraftCoordinate, stepDraftCoordinate } from "./sensorPositionDraft";
import { placementPayload, placementSaveReason, placementWriteBasis } from "./sensorPlacementPersistence";

export default function SensorPositionEditor({ sensor, statusSensor = sensor, disabledReason, renderMap, onRequestLogin,
  onSavePosition, onRefreshPosition, operation }) {
  const id = useId();
  const [values, setValues] = useState(null);
  const [touched, setTouched] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [basis, setBasis] = useState(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false), attempt = useRef(0), locked = useRef(false);
  // Changing the draft also invalidates a protected action waiting for login.
  useEffect(() => {
    mounted.current = true; attempt.current++;
    return () => { mounted.current = false; };
  }, [values]);
  const editing = Boolean(sensor && values);
  const position = editing ? draftPosition(values) : null;
  const busy = saving || ["saving", "checking"].includes(operation?.state);
  const stale = editing && JSON.stringify(basis) !== JSON.stringify(placementWriteBasis(sensor));
  const reason = placementSaveReason(statusSensor);
  const start = () => {
    if (!sensor || busy) return;
    attempt.current++;
    setValues(hasPosition(sensor) ? { row: String(sensor.placement.row), column: String(sensor.placement.column) } : { row: "", column: "" });
    setBasis(placementWriteBasis(sensor)); setTouched({}); setConfirmed(false);
  };
  const update = (field, value) => {
    attempt.current++;
    setValues((previous) => ({ ...previous, [field]: value }));
    setTouched((previous) => ({ ...previous, [field]: true }));
    setConfirmed(false);
  };
  const pick = (point) => {
    if (!editing || busy) return;
    setValues({ row: String(point.row), column: String(point.column) });
    setTouched({ row: true, column: true });
    setConfirmed(false);
  };
  const cancel = () => { attempt.current++; setValues(null); setTouched({}); setConfirmed(false); setBasis(null); };
  const save = async () => {
    const payload = placementPayload(sensor, values);
    if (!payload || !confirmed || stale || busy || locked.current || operation?.state === "needs_read" || !onSavePosition) return;
    const request = ++attempt.current;
    locked.current = true; setSaving(true);
    try {
      const result = await onSavePosition(sensor.id, payload, () => mounted.current && attempt.current === request);
      if (result && mounted.current && attempt.current === request) cancel();
    } catch {
      if (mounted.current && attempt.current === request) setConfirmed(false);
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <>
    {statusSensor && reason && <p role={statusSensor.placementSource === "db" ? "alert" : undefined} className="mb-3 text-xs text-amber-800">{reason}</p>}
    {operation?.message && (operation.state !== "success" || (!editing && statusSensor?.placementSource === "db")) && <p role={operation.state === "error" || operation.state === "needs_read" ? "alert" : "status"}
      data-placement-operation={operation.state} className={`mb-3 rounded-md p-3 text-sm ${operation.state === "success" ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-700"}`}>{operation.message}</p>}
    {operation?.state === "needs_read" && <button type="button" className="map-control mb-3 px-3" disabled={busy}
      onClick={() => { setConfirmed(false); void onRefreshPosition?.(); }}>Periksa Posisi</button>}
    {!editing ? <div className="mb-4">
      <button type="button" className="map-control gap-2 px-3" disabled={busy || (!sensor && !onRequestLogin)}
        onClick={() => { if (sensor) start(); else onRequestLogin?.(); }}>
        Atur Posisi Sensor
      </button>
      {!sensor && <p className="mt-2 text-xs text-slate-500">{disabledReason}</p>}
    </div> : <form className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-4" aria-label="Atur Posisi Sensor" noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!sensor || busy) return;
        setTouched({ row: true, column: true });
        setConfirmed(Boolean(position));
        if (!position) event.currentTarget.elements.namedItem(parseDraftCoordinate(values.row, coordinateMaximum.row) === null ? "row" : "column")?.focus();
      }}>
      <h3 className="text-sm font-semibold text-slate-900">Atur Posisi Sensor — {sensor.sensor_name || `Sensor ${sensor.id}`} (ID {sensor.id})</h3>
      <p className="mt-1 text-xs text-slate-600">Posisi lama: {hasPosition(sensor) ? `Baris ${sensor.placement.row}, Kolom ${sensor.placement.column}` : "Belum dikonfigurasi"}.</p>
      <p className="mt-2 text-xs text-slate-600">Pilih titik bibit atau isi koordinat. Pratinjau hanya sementara dan belum disimpan permanen.</p>
      {busy && <p className="mt-2 text-xs text-slate-600">Permintaan sedang diproses. Menutup draft tidak membatalkan penyimpanan yang sudah dikirim.</p>}
      {basis && <p className="mt-2 text-xs text-slate-600">Versi posisi: {basis.expectedVersion ?? "Belum ditempatkan"}.</p>}
      {stale && <div role="alert" className="mt-3 text-xs text-amber-800">Data posisi atau konteks telah berubah. Muat posisi terbaru lalu tinjau kembali.
        <button type="button" className="map-control ml-2 bg-white px-3" disabled={busy} onClick={start}>Muat Posisi Terbaru</button></div>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[["row", "Baris"], ["column", "Kolom"]].map(([field, label]) => {
          const maximum = coordinateMaximum[field];
          const number = parseDraftCoordinate(values[field], maximum);
          const error = touched[field] && number === null;
          return <div key={field}>
            <label htmlFor={`${id}-${field}`} className="text-xs font-semibold text-slate-700">{label} (1–{maximum})</label>
            <div className="mt-1 flex gap-2">
              <button type="button" className="map-control shrink-0 bg-white" aria-label={`Kurangi ${label.toLowerCase()}`} disabled={busy || number === null || number === 1}
                onClick={() => update(field, stepDraftCoordinate(values[field], -1, maximum))}><FiMinus aria-hidden="true" /></button>
              <input id={`${id}-${field}`} name={field} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={values[field]} disabled={busy} onChange={(event) => update(field, event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-${field}-error` : undefined} />
              <button type="button" className="map-control shrink-0 bg-white" aria-label={`Tambah ${label.toLowerCase()}`} disabled={busy || number === maximum || (number === null && values[field] !== "")}
                onClick={() => update(field, stepDraftCoordinate(values[field], 1, maximum))}><FiPlus aria-hidden="true" /></button>
            </div>
            {error && <p id={`${id}-${field}-error`} role="alert" className="mt-1 text-xs text-red-700">{label} harus berupa bilangan bulat antara 1 dan {maximum}.</p>}
          </div>;
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="map-control bg-white px-3" disabled={busy}>Pratinjau Posisi</button>
        <button type="button" className="map-control bg-white px-3" disabled={busy || !confirmed || !position || stale || Boolean(reason) || !onSavePosition || operation?.state === "needs_read"} onClick={save}>
          {busy ? "Menyimpan…" : "Simpan Posisi"}</button>
        <button type="button" className="map-control bg-white px-3" onClick={cancel}>Batal</button>
      </div>
      {position && <p className="mt-2 text-xs text-slate-700">Pratinjau: Baris {position.row}, Kolom {position.column}.</p>}
      {confirmed && <p role="status" className="mt-2 text-xs font-medium text-sky-800">Pratinjau posisi valid. Perubahan belum disimpan permanen.</p>}
    </form>}
    {renderMap({ editing, position, onPick: editing && !busy ? pick : undefined })}
  </>;
}
