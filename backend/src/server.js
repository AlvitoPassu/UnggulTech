import "dotenv/config";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(", ")}`);
}

const port = Number(process.env.PORT || 3001);
const logsTable = process.env.SUPABASE_LOGS_TABLE || "sensor_logs";
const timestampColumn = process.env.SUPABASE_LOGS_TIMESTAMP_COLUMN || "created_at";
const statusColumn = process.env.SUPABASE_LOGS_STATUS_COLUMN || "status";
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "100kb" }));

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const makeFilename = (sensorId, startDate, endDate, format) =>
  `Laporan_Bedengan${sensorId}_${startDate}${startDate !== endDate ? `_sampai_${endDate}` : ""}.${format}`;

function validateRequest(body) {
  const { sensorId, startDate, endDate, format, status } = body || {};
  const validFormats = ["csv", "xlsx", "pdf"];
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!sensorId || !validDate(startDate) || !validDate(endDate) || startDate > endDate || !validFormats.includes(format)) {
    return null;
  }

  return { sensorId: String(sensorId), startDate, endDate, format, status: status ? String(status) : null };
}

async function getLogs({ sensorId, startDate, endDate, status }) {
  const startTimestamp = `${startDate}T00:00:00.000Z`;
  const endTimestamp = `${endDate}T23:59:59.999Z`;
  let query = supabase
    .from(logsTable)
    .select("*")
    .eq("sensor_id", sensorId)
    .gte(timestampColumn, startTimestamp)
    .lte(timestampColumn, endTimestamp)
    .order(timestampColumn, { ascending: true })
    .limit(10000);

  if (status) query = query.eq(statusColumn, status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function reportRows(logs) {
  return logs.map((log) => ({
    timestamp: log[timestampColumn] ?? "",
    moisture: log.moisture ?? log.soil_moisture ?? "",
    temperature: log.temperature ?? "",
    status: log[statusColumn] ?? "",
    pump: log.pump ?? log.pump_status ?? "",
  }));
}

function sendCsv(res, rows) {
  const columns = ["Waktu", "Kelembapan Tanah (%)", "Suhu (°C)", "Status", "Pompa"];
  const csv = [columns, ...rows.map((row) => [row.timestamp, row.moisture, row.temperature, row.status, row.pump])]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
  res.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
}

async function sendXlsx(res, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Laporan Sensor");
  sheet.columns = [
    { header: "Waktu", key: "timestamp", width: 26 },
    { header: "Kelembapan Tanah (%)", key: "moisture", width: 24 },
    { header: "Suhu (°C)", key: "temperature", width: 16 },
    { header: "Status", key: "status", width: 16 },
    { header: "Pompa", key: "pump", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  const buffer = await workbook.xlsx.writeBuffer();
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(buffer));
}

function sendPdf(res, rows) {
  const document = new PDFDocument({ margin: 36, size: "A4" });
  res.type("application/pdf");
  document.pipe(res);
  document.fontSize(16).text("Laporan Sensor", { align: "center" }).moveDown();
  document.fontSize(9).text("Waktu | Kelembapan (%) | Suhu (°C) | Status | Pompa").moveDown(0.5);
  rows.forEach((row) => {
    document.text(`${row.timestamp} | ${row.moisture} | ${row.temperature} | ${row.status} | ${row.pump}`);
  });
  document.end();
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/reports/download", async (req, res, next) => {
  try {
    const filters = validateRequest(req.body);
    if (!filters) return res.status(400).json({ message: "Parameter laporan tidak valid." });

    const logs = await getLogs(filters);
    const rows = reportRows(logs);
    const filename = makeFilename(filters.sensorId, filters.startDate, filters.endDate, filters.format);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    if (filters.format === "csv") return sendCsv(res, rows);
    if (filters.format === "xlsx") return sendXlsx(res, rows);
    return sendPdf(res, rows);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message);
  res.status(500).json({ message: "Gagal membuat laporan." });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
