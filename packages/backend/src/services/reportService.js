import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { config } from "../config/supabase.js";
import { formatWitaTimestamp, witaDateFormatter } from "../utils/dateHelper.js";

const getMoistureStatus = (moisture) => {
  const value = Number(moisture);
  if (!Number.isFinite(value)) return "Tidak tersedia";
  if (value < 40) return "Low";
  if (value > 70) return "High";
  return "Normal";
};

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export const makeFilename = (sensorId, startDate, endDate, format) =>
  `Laporan_Bedengan${sensorId}_${startDate}${startDate !== endDate ? `_sampai_${endDate}` : ""}.${format}`;

export function reportRows(logs) {
  return logs.map((log) => ({
    timestamp: formatWitaTimestamp(log[config.timestampColumn]),
    moisture: log.moisture ?? log.soil_moisture ?? "",
    temperature: log.temperature ?? "",
    status: log[config.statusColumn] ?? getMoistureStatus(log.moisture ?? log.soil_moisture),
    pump: log.pump ?? log.pump_status ?? "",
  }));
}

export function sendCsv(res, rows) {
  const columns = ["Waktu (WITA)", "Kelembapan Tanah (%)", "Suhu (°C)", "Status", "Pompa"];
  const csv = [columns, ...rows.map((row) => [row.timestamp, row.moisture, row.temperature, row.status, row.pump])]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
  res.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
}

export async function sendXlsx(res, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Laporan Sensor");
  sheet.columns = [
    { header: "Waktu (WITA)", key: "timestamp", width: 28 },
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

export function sendPdf(res, rows, startDate, endDate) {
  const document = new PDFDocument({ margin: 36, size: "A4" });
  const dateRange = startDate === endDate
    ? witaDateFormatter.format(new Date(`${startDate}T00:00:00+08:00`))
    : `${witaDateFormatter.format(new Date(`${startDate}T00:00:00+08:00`))} - ${witaDateFormatter.format(new Date(`${endDate}T00:00:00+08:00`))}`;

  res.type("application/pdf");
  document.pipe(res);
  document.fontSize(16).text("Laporan Sensor", { align: "center" });
  document.fontSize(10).text(`Rentang tanggal: ${dateRange} (WITA)`, { align: "center" }).moveDown();
  document.fontSize(9).text("Waktu (WITA) | Kelembapan (%) | Suhu (°C) | Status | Pompa").moveDown(0.5);
  rows.forEach((row) => {
    document.text(`${row.timestamp} | ${row.moisture} | ${row.temperature} | ${row.status} | ${row.pump}`);
  });
  document.end();
}
