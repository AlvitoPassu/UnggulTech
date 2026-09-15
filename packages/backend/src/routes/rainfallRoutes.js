import { Router } from "express";
import { createRainfallReading, getLatestRainfall, getRainfallHistory, getRainfallTrend, updateRainfallReading } from "../services/rainfallService.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { logAudit } from "../services/auditService.js";

const router = Router();

router.get("/latest", async (req, res, next) => {
  try {
    const rainfall = await getLatestRainfall(req.query);
    return res.json(rainfall);
  } catch (error) {
    next(error);
  }
});

router.get("/trend", async (req, res, next) => {
  try {
    const trend = await getRainfallTrend(req.query.period || "7d", req.query);
    return res.json(trend);
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ message: "Payload tidak valid." });
    }

    const reading = await createRainfallReading(body);

    await logAudit({
      userId: req.user?.id,
      action: "RAINFALL_CREATE",
      resource: "rainfall_readings",
      resourceId: reading?.id,
      metadata: {
        bedengan: reading?.bedengan,
        nursery: reading?.nursery,
        rainfall_value: reading?.rainfall_value,
        unit: reading?.unit,
        measured_at: reading?.measured_at,
      },
      req,
    });

    return res.status(201).json({ message: "Data curah hujan berhasil disimpan.", reading });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ message: error.message });
    next(error);
  }
});

router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ message: "Payload tidak valid." });
    }

    const reading = await updateRainfallReading(req.params.id, body);

    await logAudit({
      userId: req.user?.id,
      action: "RAINFALL_UPDATE",
      resource: "rainfall_readings",
      resourceId: req.params.id,
      metadata: {
        rainfall_value: reading?.rainfall_value,
        measured_at: reading?.measured_at,
        bedengan: reading?.bedengan,
        nursery: reading?.nursery,
        notes: reading?.notes,
      },
      req,
    });

    return res.json({ message: "Data curah hujan berhasil diperbarui.", reading });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    next(error);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const readings = await getRainfallHistory(req.query);
    return res.json({ readings });
  } catch (error) {
    next(error);
  }
});

export default router;
