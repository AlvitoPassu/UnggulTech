import { useEffect, useState } from "react";
import { getSensors, getSensorData, getRecentLogs, getGlobalSoilPh, getGlobalSoilPhHistory, saveSensorPlacement } from "../../api/sensorApi";
import { getMapLocation, sensorsForBed } from "./sensorMapModel";
import { SensorPlacementRegistry } from "./sensorPlacementPersistence";

// Preserve the existing 60s registry / 30s readings cadence. Cleanup rejects late
// responses from a previous selection, including rapid bed changes.
export default function useSensorMonitoring(selection) {
  const [placementRegistry] = useState(() => new SensorPlacementRegistry({ read: () => getSensors({ timeout: 10_000 }), write: saveSensorPlacement }));
  const [registry, setRegistry] = useState(() => placementRegistry.view);
  const [readings, setReadings] = useState({ sensorId: "", loading: false });
  const [ph, setPh] = useState({ loading: true });
  const location = getMapLocation(registry.sensors);
  const selectedSensor = (selection.bed ? sensorsForBed(registry.sensors, location, selection.bed) : [])
    .find((sensor) => String(sensor.id) === selection.sensorId);
  const selectedSensorId = selectedSensor ? String(selectedSensor.id) : "";
  const readingSelection = selectedSensorId ? selection : null;

  useEffect(() => {
    placementRegistry.activate();
    const unsubscribe = placementRegistry.subscribe(setRegistry);
    void placementRegistry.refresh();
    const interval = setInterval(() => { void placementRegistry.refresh(); }, 60_000);
    return () => { unsubscribe(); placementRegistry.deactivate(); clearInterval(interval); };
  }, [placementRegistry]);

  useEffect(() => {
    let active = true;
    let pending = false;
    const fetchData = async () => {
      if (pending) return;
      pending = true;
      const jobs = [
        getGlobalSoilPh(), getGlobalSoilPhHistory(10),
        ...(selectedSensorId ? [getSensorData(selectedSensorId), getRecentLogs(selectedSensorId, { throwOnError: true })] : []),
      ];
      const [phResult, historyResult, dataResult, logsResult] = await Promise.allSettled(jobs);
      if (active) {
        setPh({ loading: false, data: phResult.status === "fulfilled" ? phResult.value : null,
          history: historyResult.status === "fulfilled" ? historyResult.value : [],
          error: phResult.status === "rejected", historyError: historyResult.status === "rejected" });
        setReadings({ selection: readingSelection, sensorId: selectedSensorId, loading: false,
          data: dataResult?.status === "fulfilled" ? dataResult.value : null,
          logs: logsResult?.status === "fulfilled" ? logsResult.value : [],
          error: dataResult?.status === "rejected", logsError: logsResult?.status === "rejected" });
      }
      pending = false;
    };
    void fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => { active = false; clearInterval(interval); };
  }, [selectedSensorId, readingSelection]);

  // Hide cached data immediately, even when A -> B -> A happens before B loads.
  const currentReadings = readings.selection === readingSelection && readings.sensorId === selectedSensorId
    ? readings : { sensorId: selectedSensorId, loading: Boolean(selectedSensorId) };
  return { registry, readings: currentReadings, ph, location, selectedSensor, selectedSensorId,
    savePlacement: (id, payload) => placementRegistry.save(id, payload),
    refreshRegistry: () => placementRegistry.refresh() };
}
