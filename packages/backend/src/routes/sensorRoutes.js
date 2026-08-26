import { Router } from "express";
import { supabase, config } from "../config/supabase.js";
import { formatWitaTimestamp } from "../utils/dateHelper.js";
import { validateSensorId } from "../utils/validators.js";
import { getRecentLogs, insertSensorReadings } from "../services/sensorService.js";

const router = Router();

// -----------------------------
// POST /api/sensors
// Menerima data dari ESP32 dan menyimpan ke Supabase
// -----------------------------
router.post("/", async (req, res, next) => {
  try {
    const body = req.body;

    if (!body || typeof body !== "object") {
      return res.status(400).json({ message: "Payload tidak valid." });
    }

    const results = await insertSensorReadings(body);
    return res.status(201).json({ message: "Data sensor berhasil disimpan.", results });
  } catch (error) {
    next(error);
  }
});

// -----------------------------
// GET /api/sensors/:sensorId/recent-logs
// -----------------------------
router.get("/:sensorId/recent-logs", async (req, res, next) => {
  try {
    const sensorId = validateSensorId(req.params.sensorId);

    if (!sensorId) {
      return res.status(400).json({ message: "Sensor ID tidak valid." });
    }

    const logs = await getRecentLogs(sensorId);
    const rows = logs.map((log) => ({
      id: log.id,
      time: formatWitaTimestamp(log[config.timestampColumn]),
      moisture: log.moisture ?? log.soil_moisture ?? null,
      temperature: log.temperature ?? null,
      action: log[config.statusColumn] ?? "Sensor Reading",
    }));

    return res.json(rows);
  } catch (error) {
    next(error);
  }
});

export default router;
