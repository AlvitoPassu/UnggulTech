import { Router } from "express";
import { config } from "../config/supabase.js";
import { formatWitaTimestamp } from "../utils/dateHelper.js";
import { validateSensorId } from "../utils/validators.js";
import { getRecentLogs } from "../services/sensorService.js";

const router = Router();

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
