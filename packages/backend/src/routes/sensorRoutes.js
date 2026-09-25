import { Router } from "express";
import { supabase, config } from "../config/supabase.js";
import { formatWitaTimestamp } from "../utils/dateHelper.js";
import { validateSensorId } from "../utils/validators.js";
import { getNurseryMoistureTrend, getNurseryOverview, getRecentLogs, getSensorData, getSensors, insertSensorReadings } from "../services/sensorService.js";
import { classifyMoisture } from "../domain/moistureClassifier.js";
import { createSoilPhReading, getLatestSoilPh, getSoilPhHistory } from "../services/soilPhService.js";

const router = Router();

// GET /api/sensors
router.get("/", async (_req, res, next) => {
  try {
    return res.json(await getSensors());
  } catch (error) {
    next(error);
  }
});

router.get("/overview", async (_req, res, next) => {
  try {
    return res.json(await getNurseryOverview());
  } catch (error) {
    next(error);
  }
});

router.get("/moisture-trend", async (req, res, next) => {
  try {
    return res.json(await getNurseryMoistureTrend(req.query.period));
  } catch (error) {
    next(error);
  }
});

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
    const rejected = results.filter((result) => result.success === false);
    if (rejected.length > 0) {
      return res.status(400).json({ message: "Data sensor tidak valid.", results });
    }
    return res.status(201).json({ message: "Data sensor berhasil disimpan.", results });
  } catch (error) {
    next(error);
  }
});

// Global pH is intentionally separate from per-bedengan moisture readings.
router.post("/ph", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ message: "Payload pH tidak valid." });
    }

    const reading = await createSoilPhReading(req.body);
    return res.status(201).json({ message: "Data pH berhasil disimpan.", reading });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ message: error.message });
    return next(error);
  }
});

router.get("/ph", async (_req, res, next) => {
  try {
    return res.json(await getLatestSoilPh());
  } catch (error) {
    return next(error);
  }
});

router.get("/ph/history", async (req, res, next) => {
  try {
    return res.json({ readings: await getSoilPhHistory(req.query.limit) });
  } catch (error) {
    return next(error);
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
    const rows = logs.map((log) => {
      const moisture = log.moisture ?? log.soil_moisture ?? null;
      const classification = classifyMoisture(moisture);

      return {
        id: log.id,
        time: formatWitaTimestamp(log[config.timestampColumn]),
        moisture,
        temperature: log.temperature ?? null,
        humidity: log.humidity ?? null,
        action: classification.legacyStatus || "Tidak tersedia",
        status: classification.legacyStatus || "Tidak tersedia",
        legacyStatus: classification.legacyStatus,
        condition: classification.condition,
        needsAttention: classification.needsAttention,
      };
    });

    return res.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/sensors/:sensorId/data
router.get("/:sensorId/data", async (req, res, next) => {
  try {
    const sensorId = validateSensorId(req.params.sensorId);

    if (!sensorId) {
      return res.status(400).json({ message: "Sensor ID tidak valid." });
    }

    return res.json(await getSensorData(sensorId));
  } catch (error) {
    next(error);
  }
});

export default router;
