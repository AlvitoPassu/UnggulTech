import { Router } from "express";
import { validateHistoricalFilters, validateHistoricalTrend } from "../utils/validators.js";
import { getHistoricalReadings, getHistoricalStatistics, getHistoricalTrend } from "../services/historicalService.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const filters = validateHistoricalFilters(req.query);
    if (!filters) return res.status(400).json({ message: "Parameter data historis tidak valid." });
    return res.json(await getHistoricalReadings(filters));
  } catch (error) {
    return next(error);
  }
});

router.get("/statistics", async (req, res, next) => {
  try {
    const filters = validateHistoricalFilters({ ...req.query, page: 1, limit: 100 });
    if (!filters) return res.status(400).json({ message: "Parameter statistik historis tidak valid." });
    return res.json({ statistics: await getHistoricalStatistics(filters) });
  } catch (error) {
    return next(error);
  }
});

router.get("/trend", async (req, res, next) => {
  try {
    const filters = validateHistoricalTrend(req.query);
    if (!filters) return res.status(400).json({ message: "Parameter trend historis tidak valid." });
    return res.json({ trend: await getHistoricalTrend(filters) });
  } catch (error) {
    return next(error);
  }
});

export default router;