import { Router } from "express";
import { getWeatherForecast, getWeatherLocation } from "../services/weatherService.js";

const router = Router();

router.get("/forecast", async (_req, res, next) => {
  try {
    const forecast = await getWeatherForecast();
    return res.json(forecast);
  } catch (error) {
    next(error);
  }
});

router.get("/location", async (_req, res, next) => {
  try {
    const location = await getWeatherLocation();
    return res.json(location);
  } catch (error) {
    next(error);
  }
});

export default router;
