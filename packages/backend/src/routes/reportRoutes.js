import { Router } from "express";
import { validateRequest } from "../utils/validators.js";
import { getLogs } from "../services/sensorService.js";
import {
  reportRows,
  makeFilename,
  sendCsv,
  sendXlsx,
  sendPdf,
} from "../services/reportService.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { logAudit } from "../services/auditService.js";

const router = Router();

router.post("/download", requireAuth, async (req, res, next) => {
  try {
    const filters = validateRequest(req.body);
    if (!filters) {
      return res.status(400).json({ message: "Parameter laporan tidak valid." });
    }

    const logs = await getLogs(filters);
    const rows = reportRows(logs);
    const filename = makeFilename(filters.sensorId, filters.startDate, filters.endDate, filters.format);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    await logAudit({
      userId: req.user?.id,
      action: "DOWNLOAD_HISTORICAL_DATA",
      resource: "sensor_readings",
      metadata: {
        format: filters.format,
        sensor_id: filters.sensorId,
        start_date: filters.startDate,
        end_date: filters.endDate,
        total_rows: rows.length,
      },
      req,
    });

    if (filters.format === "csv") {
      return sendCsv(res, rows);
    }
    if (filters.format === "xlsx") {
      return await sendXlsx(res, rows, filters.startDate, filters.endDate);
    }
    return sendPdf(res, rows, filters.startDate, filters.endDate);
  } catch (error) {
    next(error);
  }
});

export default router;
