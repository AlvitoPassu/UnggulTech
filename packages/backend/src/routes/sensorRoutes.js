import { Router } from "express";
import { supabase, config } from "../config/supabase.js";
import { formatWitaTimestamp } from "../utils/dateHelper.js";
import { validateSensorId } from "../utils/validators.js";
import { getNurseryMoistureTrend, getNurseryOverview, getRecentLogs, getSensorData, getSensors, insertSensorReadings } from "../services/sensorService.js";
import { classifyMoisture } from "../domain/moistureClassifier.js";
import { createSoilPhReading, getLatestSoilPh, getSoilPhHistory } from "../services/soilPhService.js";
import { alertMoistureLow, alertMoistureHigh, isTelegramConfigured, sendTestMessage } from "../services/telegramService.js";
import { requireAuth, SessionError } from "../middleware/authMiddleware.js";
import { isSensorPlacementWriteEnabled } from "../config/sensorPlacementWrite.js";
import { saveSensorPlacement, SensorPlacementError } from "../services/sensorPlacementService.js";

const router = Router();

// Backend-only write path. Monitoring and IoT routes retain their existing access.
router.put("/:sensorId/placement", (_req, res, next) => {
  if (!isSensorPlacementWriteEnabled()) {
    const error = new SensorPlacementError("SENSOR_PLACEMENT_WRITE_DISABLED");
    return res.status(error.statusCode).json({ code: error.code, message: error.message });
  }
  return next();
}, requireAuth, async (req, res, next) => {
  try {
    const saved = await saveSensorPlacement(req.params.sensorId, req.body, req.operatorIdentity);
    return res.json({ code: "OK", message: saved.unchanged ? "Posisi sensor tidak berubah." : "Posisi sensor berhasil disimpan.", ...saved });
  } catch (error) {
    if (error instanceof SensorPlacementError || error instanceof SessionError) {
      return res.status(error.statusCode || error.status).json({ code: error.code, message: error.message });
    }
    return next(error);
  }
});

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

    // -------------------------------------------------------
    // Cek kondisi kelembaban dan kirim notif Telegram jika perlu
    // Dijalankan async (tidak blokir response ke ESP32)
    // -------------------------------------------------------
    if (isTelegramConfigured()) {
      const sensors = await getSensors().catch(() => []);
      setImmediate(async () => {
        for (const result of results) {
          if (!result.success || !result.sensorId) continue;

          const sensorKey = `sensor${result.key?.replace(/\D/g, "")}`;
          const sensorPayload = body[result.key];
          if (!sensorPayload) continue;

          const moisture = Number(sensorPayload.kelembaban ?? sensorPayload.moisture ?? null);
          if (!Number.isFinite(moisture)) continue;

          const sensorInfo = sensors.find((s) => s.id === result.sensorId);
          const sensorName = sensorInfo?.sensor_name ?? `Sensor ${result.sensorId}`;
          const bedengan   = sensorInfo?.bedengan ? `Bedengan ${sensorInfo.bedengan}` : sensorName;

          // Notifikasi otomatis hanya untuk kondisi KERING (<= 30%)
          // Karena pada pembibitan kelapa sawit penyiraman rutin membuat tanah mencapai 100% (kondisi normal).
          if (moisture <= 30) {
            await alertMoistureLow({ sensorId: result.sensorId, sensorName, bedengan, moisture });
          }
        }
      });
    }

    return res.status(201).json({ message: "Data sensor berhasil disimpan.", results });
  } catch (error) {
    next(error);
  }
});

// POST /api/sensors/test-telegram
// Kirim pesan test ke Telegram untuk verifikasi konfigurasi bot
router.post("/test-telegram", async (_req, res, next) => {
  try {
    if (!isTelegramConfigured()) {
      return res.status(400).json({
        message: "Telegram belum dikonfigurasi. Isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di .env.",
      });
    }
    const success = await sendTestMessage();
    if (!success) {
      return res.status(502).json({ message: "Gagal kirim pesan test ke Telegram. Periksa token dan chat ID." });
    }
    return res.json({ message: "Pesan test berhasil dikirim ke Telegram! ✅" });
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

// Parse errors originate in app-level express.json(). Handle only this PUT path.
export function handleSensorPlacementBodyError(error, req, res, next) {
  if (req.method === "PUT" && req.path === "/" && ["entity.parse.failed", "entity.too.large"].includes(error?.type)) {
    return res.status(error.type === "entity.too.large" ? 413 : 400)
      .json({ code: "INVALID_PLACEMENT", message: "Body posisi sensor harus berupa JSON yang valid dan tidak melebihi 100kb." });
  }
  return next(error);
}

export default router;
