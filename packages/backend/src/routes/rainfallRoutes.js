import { Router } from "express";
import { createRainfallReading, getLatestRainfall, getRainfallHistory, getRainfallTrend } from "../services/rainfallService.js";

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

router.post("/", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ message: "Payload tidak valid." });
    }

    const reading = await createRainfallReading(body);
    return res.status(201).json({ message: "Data curah hujan berhasil disimpan.", reading });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ message: error.message });
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