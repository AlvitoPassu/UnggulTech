import { Router } from "express";
import { getRecommendationForSensor } from "../services/recommendationService.js";
import { validateSensorId } from "../utils/validators.js";

const router = Router();

// GET only: endpoint ini tidak menulis database atau audit log.
router.get("/decision", async (req, res, next) => {
  try {
    const sensorId = validateSensorId(req.query.sensorId);
    if (!sensorId) {
      return res.status(400).json({ message: "sensorId individual yang valid wajib diberikan." });
    }

    return res.json(await getRecommendationForSensor(sensorId));
  } catch (error) {
    next(error);
  }
});

export default router;
