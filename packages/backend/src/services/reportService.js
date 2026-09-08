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
const reportColumns = [
  { header: "No", key: "number", width: 8, align: "center" },
  { header: "Waktu (WITA)", key: "timestamp", width: 24 },
  { header: "Sensor", key: "sensor", width: 18 },
  { header: "Bedengan", key: "bedengan", width: 14 },
  { header: "Soil Moisture (%)", key: "moisture", width: 20, align: "right" },
  { header: "Soil pH", key: "ph", width: 12, align: "right" },
  { header: "Temperature (°C)", key: "temperature", width: 20, align: "right" },
  { header: "Humidity (%)", key: "humidity", width: 16, align: "right" },
  { header: "Status", key: "status", width: 16 },
  { header: "Pump", key: "pump", width: 16 },
];

const formatNumber = (value, decimals = 2) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "-";
};

const numericValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getLogValue = (log, keys) => {
  const key = keys.find((candidate) => log[candidate] !== null && log[candidate] !== undefined && log[candidate] !== "");
  return key ? log[key] : null;
};

const getSensorLabel = (log) => log.sensor_name || log.sensor || (log.sensor_id ? `Sensor ${log.sensor_id}` : "-");
const getBedenganLabel = (log) => log.bedengan ?? log.bedengan_id ?? (log.sensor_id ? `Bedengan ${log.sensor_id}` : "-");

const displayValue = (value, decimals = 2) => value === null || value === undefined || value === "" ? "-" : formatNumber(value, decimals);

const getSummary = (rows) => {
  const average = (key) => {
    const values = rows.map((row) => numericValue(row[key])).filter((value) => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  };

  return {
    count: rows.length,
    averageMoisture: average("moisture"),
    averagePh: average("ph"),
    averageTemperature: average("temperature"),
  };
};

export const makeFilename = (sensorId, startDate, endDate, format) =>
  `monitoring_data_${startDate}${startDate !== endDate ? `_to_${endDate}` : ""}.${format}`;

export function reportRows(logs) {
  return logs.map((log, index) => ({
    number: index + 1,
    timestamp: formatWitaTimestamp(log[config.timestampColumn]),
    sensor: getSensorLabel(log),
    bedengan: getBedenganLabel(log),
    moisture: numericValue(getLogValue(log, ["moisture", "soil_moisture"])),
    ph: numericValue(getLogValue(log, ["soil_ph", "ph", "pH"])),
    temperature: numericValue(log.temperature),
    humidity: numericValue(log.humidity),
    status: log[config.statusColumn] ?? getMoistureStatus(log.moisture ?? log.soil_moisture),
    pump: log.pump ?? log.pump_status ?? "-",
  }));
}

export function sendCsv(res, rows) {
  const columns = reportColumns.map(({ header }) => header);
  const csv = [columns, ...rows.map((row) => [
    row.number,
    row.timestamp,
    row.sensor,
    row.bedengan,
    displayValue(row.moisture),
    displayValue(row.ph),
    displayValue(row.temperature, 1),
    displayValue(row.humidity),
    row.status,
    row.pump,
  ])]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
  res.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
}

export async function sendXlsx(res, rows, startDate, endDate) {
  const workbook = new ExcelJS.Workbook();
  const summary = getSummary(rows);
  const summarySheet = workbook.addWorksheet("Ringkasan");
  summarySheet.columns = [{ width: 28 }, { width: 32 }];
  summarySheet.addRows([
    ["Laporan Data Monitoring Tanah", ""],
    ["Smart Soil Monitoring System", ""],
    ["Periode data", startDate === endDate ? startDate : `${startDate} sampai ${endDate}`],
    ["Sensor", rows[0]?.sensor || "-"],
    ["Jumlah data", summary.count],
    ["Rata-rata Soil Moisture (%)", summary.averageMoisture === null ? "-" : Number(summary.averageMoisture.toFixed(2))],
    ["Rata-rata Soil pH", summary.averagePh === null ? "-" : Number(summary.averagePh.toFixed(2))],
    ["Rata-rata Temperature (°C)", summary.averageTemperature === null ? "-" : Number(summary.averageTemperature.toFixed(1))],
    ["Dibuat pada", formatWitaTimestamp(new Date())],
  ]);
  summarySheet.mergeCells("A1:B1");
  summarySheet.mergeCells("A2:B2");
  summarySheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  summarySheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1686B3" } };
  summarySheet.getRow(2).font = { italic: true, color: { argb: "FF475569" } };
  summarySheet.getColumn(1).font = { bold: true, color: { argb: "FF334155" } };
  summarySheet.views = [{ showGridLines: false }];

  const sheet = workbook.addWorksheet("Data Monitoring");
  sheet.columns = reportColumns.map(({ header, key, width }) => ({ header, key, width }));
  sheet.addTable({
    name: "DataMonitoring",
    ref: `A1:J${rows.length + 1}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: reportColumns.map(({ header }) => ({ name: header })),
    rows: rows.map((row) => [
      row.number, row.timestamp, row.sensor, row.bedengan,
      row.moisture === null ? "-" : row.moisture,
      row.ph === null ? "-" : row.ph,
      row.temperature === null ? "-" : row.temperature,
      row.humidity === null ? "-" : row.humidity,
      row.status, row.pump,
    ]),
  });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  sheet.getColumn(1).alignment = { horizontal: "center" };
  [5, 6, 7, 8].forEach((column) => { sheet.getColumn(column).numFmt = column === 7 ? "0.0" : "0.00"; });
  sheet.views = [{ state: "frozen", ySplit: 1, autoFilter: "A1:J1" }];
  const buffer = await workbook.xlsx.writeBuffer();
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(buffer));
}

export function sendPdf(res, rows, startDate, endDate) {
  const document = new PDFDocument({ margin: 36, bottomMargin: 54, size: "A4", layout: "landscape" });
  const summary = getSummary(rows);
  const dateRange = startDate === endDate
    ? witaDateFormatter.format(new Date(`${startDate}T00:00:00+08:00`))
    : `${witaDateFormatter.format(new Date(`${startDate}T00:00:00+08:00`))} - ${witaDateFormatter.format(new Date(`${endDate}T00:00:00+08:00`))}`;
  const tableWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const columnWidths = [28, 104, 74, 70, 82, 50, 82, 72, 66, 66];
  const tableHeaders = reportColumns.map(({ header }) => header);
  const drawFooter = () => {
    document.save();
    document.fontSize(8).fillColor("#64748b").text("Laporan dibuat oleh Smart Soil Monitoring System", document.page.margins.left, document.page.height - 32, { lineBreak: false });
    document.text(`Halaman ${document.bufferedPageRange().count}`, document.page.width - 100, document.page.height - 32, { width: 64, align: "right", lineBreak: false });
    document.restore();
  };
  const drawTableHeader = () => {
    const startX = document.page.margins.left;
    const startY = document.y;
    document.save();
    document.rect(startX, startY, tableWidth, 25).fill("#1686b3");
    document.fillColor("white").font("Helvetica-Bold").fontSize(7);
    let x = startX;
    tableHeaders.forEach((header, index) => {
      document.text(header, x + 3, startY + 8, { width: columnWidths[index] - 6, align: "center", lineBreak: false });
      x += columnWidths[index];
    });
    document.restore();
    document.y = startY + 25;
  };
  const drawTableRow = (row) => {
    const values = [
      row.number, row.timestamp, row.sensor, row.bedengan,
      displayValue(row.moisture), displayValue(row.ph), displayValue(row.temperature, 1),
      displayValue(row.humidity), row.status, row.pump,
    ];
    const startX = document.page.margins.left;
    const startY = document.y;
    document.save();
    document.rect(startX, startY, tableWidth, 23).fill(row.number % 2 === 0 ? "#f8fafc" : "#ffffff");
    document.strokeColor("#cbd5e1").lineWidth(0.4).rect(startX, startY, tableWidth, 23).stroke();
    document.fillColor("#334155").font("Helvetica").fontSize(7);
    let x = startX;
    values.forEach((value, index) => {
      document.text(String(value), x + 3, startY + 8, { width: columnWidths[index] - 6, align: reportColumns[index].align || "left", lineBreak: false, ellipsis: true });
      x += columnWidths[index];
    });
    document.restore();
    document.y = startY + 23;
  };

  res.type("application/pdf");
  document.pipe(res);
  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text("Laporan Data Monitoring Tanah", { align: "center" });
  document.fillColor("#475569").font("Helvetica").fontSize(10).text("Smart Soil Monitoring System", { align: "center" });
  document.fontSize(9).text(`Periode data: ${dateRange} (WITA)`, { align: "center" }).moveDown(1);
  document.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text("Ringkasan Data");
  document.font("Helvetica").fontSize(9).fillColor("#334155").text(`Sensor: ${rows[0]?.sensor || "-"}    |    Jumlah data: ${summary.count}    |    Dibuat: ${formatWitaTimestamp(new Date())}`);
  document.text(`Rata-rata Soil Moisture: ${displayValue(summary.averageMoisture)}%    |    Rata-rata Soil pH: ${displayValue(summary.averagePh)}    |    Rata-rata Temperature: ${displayValue(summary.averageTemperature, 1)} °C`).moveDown(1);
  document.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text("Data Monitoring").moveDown(0.4);
  drawTableHeader();
  rows.forEach((row) => {
    if (document.y + 23 > document.page.height - document.page.margins.bottom) {
      drawFooter();
      document.addPage();
      drawTableHeader();
    }
    drawTableRow(row);
  });
  drawFooter();
  document.end();
}
