import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { config } from "../config/supabase.js";
import { formatWitaTimestamp, witaDateFormatter } from "../utils/dateHelper.js";
import { classifyMoisture } from "../domain/moistureClassifier.js";

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const reportColumns = [
  { header: "No", key: "number", width: 8, align: "center" },
  { header: "Waktu (WITA)", key: "timestamp", width: 24 },
  { header: "Sensor", key: "sensor", width: 18 },
  { header: "Bedengan", key: "bedengan", width: 14 },
  { header: "Soil Moisture (%)", key: "moisture", width: 20, align: "right" },
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
    averageTemperature: average("temperature"),
  };
};

export const makeFilename = (sensorId, startDate, endDate, format) =>
  `monitoring_data_${startDate}${startDate !== endDate ? `_to_${endDate}` : ""}.${format}`;

export function reportRows(logs) {
  return logs.map((log, index) => {
    const rawMoisture = getLogValue(log, ["moisture", "soil_moisture"]);
    const classification = classifyMoisture(rawMoisture);

    return {
      number: index + 1,
      timestamp: formatWitaTimestamp(log[config.timestampColumn]),
      sensor: getSensorLabel(log),
      bedengan: getBedenganLabel(log),
      moisture: numericValue(rawMoisture),
      temperature: numericValue(log.temperature),
      humidity: numericValue(log.humidity),
      status: classification.legacyStatus,
      condition: classification.condition,
      needsAttention: classification.needsAttention,
      sourceStatus: log[config.statusColumn] ?? null,
      pump: log.pump ?? log.pump_status ?? "-",
    };
  });
}

export function sendCsv(res, rows, globalSoilPh = {}) {
  const columns = reportColumns.map(({ header }) => header);
  const csv = [["Global Soil pH", globalSoilPh.soilPh == null ? "-" : formatNumber(globalSoilPh.soilPh)], ["Pengukuran pH terakhir (WITA)", globalSoilPh.measuredAt ? formatWitaTimestamp(globalSoilPh.measuredAt) : "-"], [], columns, ...rows.map((row) => [
    row.number,
    row.timestamp,
    row.sensor,
    row.bedengan,
    displayValue(row.moisture),
    displayValue(row.temperature, 1),
    displayValue(row.humidity),
    row.status,
    row.pump,
  ])]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
  res.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
}

export async function sendXlsx(res, rows, startDate, endDate, globalSoilPh = {}) {
  const workbook = new ExcelJS.Workbook();
  const summary = getSummary(rows);
  const blue = "FF1DAADF";
  const white = "FFFFFFFF";
  const paleBlue = "FFF0F9FD";
  const border = Object.fromEntries(["top", "left", "bottom", "right"].map((side) => [
    side, { style: "thin", color: { argb: "FFDCE6ED" } },
  ]));
  const dateFormat = 'dd/mm/yyyy hh:mm:ss "WITA"';
  const fill = (color) => ({ type: "pattern", pattern: "solid", fgColor: { argb: color } });

  // reportRows already contains WITA wall-clock text. Excel dates have no timezone:
  // encode those same components as UTC so Excel displays them without another offset.
  const excelDate = (value) => {
    const match = typeof value === "string" && value.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2})[.:](\d{2})[.:](\d{2})\s+WITA$/);
    if (!match) return value;
    const [, day, month, year, hour, minute, second] = match.map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  };

  // Account for word wrapping and long identifiers when sizing text rows.
  const textLines = (value, width) => {
    if (typeof value !== "string") return 1;
    const capacity = Math.max(1, Math.floor(width - 4));
    return value.split(/\r?\n/).reduce((total, line) => {
      let lines = 1;
      let used = 0;
      line.split(/\s+/).forEach((word) => {
        if (used && used + 1 + word.length > capacity) { lines += 1; used = 0; }
        const length = used ? used + 1 + word.length : word.length;
        lines += Math.max(0, Math.ceil(length / capacity) - 1);
        used = length ? ((length - 1) % capacity) + 1 : 0;
      });
      return total + lines;
    }, 0);
  };
  const pageSetup = (orientation, printArea) => ({
    paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    horizontalCentered: true, printArea,
  });
  const summarySheet = workbook.addWorksheet("Ringkasan");
  summarySheet.columns = [{ width: 36 }, { width: 44 }];
  summarySheet.addRows([
    ["Laporan Data Monitoring Tanah", ""],
    ["Smart Soil Monitoring System", ""],
    [],
    ["Informasi", "Nilai"],
    ["Nama sistem", "Smart Soil Monitoring System"],
    ["Periode data", startDate === endDate ? startDate : `${startDate} sampai ${endDate}`],
    ["Sensor", rows[0]?.sensor || "-"],
    ["Jumlah data", summary.count],
    ["Rata-rata Soil Moisture (%)", summary.averageMoisture ?? "-"],
    ["Global Soil pH", globalSoilPh.soilPh ?? "-"],
    ["Pengukuran pH terakhir", globalSoilPh.measuredAt ? excelDate(formatWitaTimestamp(globalSoilPh.measuredAt)) : "-"],
    ["Rata-rata Temperature (°C)", summary.averageTemperature ?? "-"],
    ["Dibuat pada", excelDate(formatWitaTimestamp(new Date()))],
  ]);
  summarySheet.mergeCells("A1:B1");
  summarySheet.mergeCells("A2:B2");
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;
    row.height = Math.max(26, ...[1, 2].map((column) => textLines(row.getCell(column).value, summarySheet.getColumn(column).width) * 15 + 10));
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: "Calibri", size: 11, bold: column === 1, color: { argb: "FF334155" } };
      cell.fill = fill(rowNumber % 2 ? paleBlue : white);
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: typeof cell.value === "number" ? "right" : "left", indent: 1, wrapText: true };
    });
  });
  [1, 2, 4].forEach((rowNumber) => {
    const row = summarySheet.getRow(rowNumber);
    row.height = rowNumber === 1 ? 40 : 28;
    row.font = { name: "Calibri", size: rowNumber === 1 ? 20 : 11, bold: rowNumber !== 2, color: { argb: white } };
    row.fill = fill(blue);
    row.alignment = { vertical: "middle", horizontal: rowNumber === 4 ? "left" : "center", indent: rowNumber === 4 ? 1 : 0 };
  });
  summarySheet.getRow(3).height = 12;
  summarySheet.getCell("B8").numFmt = "#,##0";
  ["B9", "B10"].forEach((address) => { summarySheet.getCell(address).numFmt = "0.00"; });
  summarySheet.getCell("B12").numFmt = "0.0";
  ["B11", "B13"].forEach((address) => { summarySheet.getCell(address).numFmt = dateFormat; });
  summarySheet.views = [{ showGridLines: false }];
  summarySheet.pageSetup = pageSetup("portrait", "A1:B13");

  const sheet = workbook.addWorksheet("Data Monitoring");
  const tableRows = rows.map((row) => [
    row.number, excelDate(row.timestamp), row.sensor, row.bedengan,
    row.moisture === null ? "-" : row.moisture,
    row.temperature === null ? "-" : row.temperature,
    row.humidity === null ? "-" : row.humidity,
    row.status, row.pump,
  ]);
  sheet.columns = reportColumns.map(({ header, key, width }) => ({ header, key, width }));
  sheet.addTable({
    name: "DataMonitoring",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    // Direct cell styles provide the exact brand blue instead of a theme colour.
    style: { theme: null, showRowStripes: false },
    columns: reportColumns.map(({ header }) => ({ name: header, filterButton: true })),
    rows: tableRows,
  });
  const maxWidths = [12, 32, 36, 26, 24, 24, 20, 26, 30];
  reportColumns.forEach(({ width, align }, index) => {
    const column = sheet.getColumn(index + 1);
    let longest = column.header.length;
    tableRows.forEach((row) => {
      const value = row[index];
      const text = value instanceof Date ? "00/00/0000 00:00:00 WITA" : String(value ?? "");
      longest = Math.max(longest, ...text.split(/\r?\n/).map((line) => line.length));
    });
    column.width = Math.min(maxWidths[index], Math.max(width, longest + 4));
    column.alignment = { horizontal: align || "left", vertical: "middle", wrapText: true };
    column.font = { name: "Calibri", size: 11, color: { argb: "FF334155" } };
  });
  sheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 34 : Math.max(24, ...tableRows[rowNumber - 2].map((value, index) => textLines(value, sheet.getColumn(index + 1).width) * 15 + 8));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = fill(rowNumber === 1 ? blue : rowNumber % 2 ? paleBlue : white);
      cell.border = border;
    });
  });
  sheet.getRow(1).font = { name: "Calibri", size: 11, bold: true, color: { argb: white } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  sheet.getColumn(1).numFmt = "0";
  sheet.getColumn(2).numFmt = dateFormat;
  [5, 6, 7].forEach((column) => { sheet.getColumn(column).numFmt = column === 6 ? "0.0" : "0.00"; });
  sheet.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2", showGridLines: false }];
  sheet.pageSetup = { ...pageSetup("landscape", `A1:I${rows.length + 1}`), printTitlesRow: "1:1" };
  const buffer = await workbook.xlsx.writeBuffer();
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(buffer));
}

export function sendPdf(res, rows, startDate, endDate, globalSoilPh = {}) {
  const pageOptions = { margins: { top: 36, right: 36, bottom: 56, left: 36 }, size: "A4", layout: "landscape" };
  const document = new PDFDocument({ ...pageOptions, bufferPages: true });
  const summary = getSummary(rows);
  const createdAt = formatWitaTimestamp(new Date());
  const dateRange = startDate === endDate
    ? witaDateFormatter.format(new Date(`${startDate}T00:00:00+08:00`))
    : `${witaDateFormatter.format(new Date(`${startDate}T00:00:00+08:00`))} - ${witaDateFormatter.format(new Date(`${endDate}T00:00:00+08:00`))}`;
  const tableWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const pageWidth = document.page.width;
  const pageHeight = document.page.height;
  const left = document.page.margins.left;
  const padding = 6;
  const fontSize = 9;
  // PDF widths are independent of the shared CSV/Excel column definitions.
  const columnWeights = [40, 116, 130, 75, 90, 90, 80, 74, 74];
  const totalWeight = columnWeights.reduce((total, width) => total + width, 0);
  const columnWidths = columnWeights.map((width) => tableWidth * width / totalWeight);
  const tableHeaders = reportColumns.map(({ header }) => header.replace(/ \(/, "\n("));
  const cellOptions = (width, align = "left") => ({ width: width - padding * 2, align, lineGap: 1 });
  const measureCells = (values, bold = false) => {
    document.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const heights = values.map((value, index) => document.heightOfString(String(value), cellOptions(columnWidths[index])));
    return { heights, height: Math.max(26, ...heights.map((height) => height + padding * 2)) };
  };
  const headerLayout = measureCells(tableHeaders, true);
  const drawCells = (values, layout, bold = false) => {
    const startY = document.y;
    let x = left;
    document.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(bold ? "#ffffff" : "#334155");
    values.forEach((value, index) => {
      const align = bold ? "center" : reportColumns[index].align || "left";
      document.text(String(value), x + padding, startY + (layout.height - layout.heights[index]) / 2, cellOptions(columnWidths[index], align));
      x += columnWidths[index];
    });
    // Wrapping a cell must not move the next cell or the start of the next row.
    document.x = left;
    document.y = startY + layout.height;
  };
  const drawTableHeader = () => {
    document.rect(left, document.y, tableWidth, headerLayout.height).fill("#1DAADF");
    drawCells(tableHeaders, headerLayout, true);
  };
  const ensureSpace = (height, monitoring = false) => {
    if (document.y + height <= document.page.height - document.page.margins.bottom) return;
    const title = "Laporan Data Monitoring Tanah";
    const subtitle = `Smart Soil Monitoring System | Periode: ${dateRange} (WITA)`;
    document.font("Helvetica-Bold").fontSize(11);
    const titleHeight = document.heightOfString(title, { width: tableWidth });
    document.font("Helvetica").fontSize(fontSize);
    const subtitleHeight = document.heightOfString(subtitle, { width: tableWidth });
    const requiredHeight = pageOptions.margins.top + titleHeight + subtitleHeight + 12 + height + pageOptions.margins.bottom + (monitoring ? headerLayout.height : 0);
    // An exceptionally long cell gets a taller page, keeping all text and the row intact.
    // Normal reports use consistent A4 landscape pages at the same readable font size.
    document.addPage(requiredHeight > pageHeight
      ? { ...pageOptions, size: [pageWidth, requiredHeight + 1], layout: "portrait" }
      : pageOptions);
    document.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(title, left, document.page.margins.top, { width: tableWidth });
    document.font("Helvetica").fontSize(fontSize).fillColor("#64748b").text(subtitle, { width: tableWidth });
    document.y += 12;
    if (monitoring) drawTableHeader();
  };
  const drawTableRow = (row) => {
    const values = [
      row.number, row.timestamp, row.sensor, row.bedengan,
      displayValue(row.moisture), displayValue(row.temperature, 1),
      displayValue(row.humidity), row.status, row.pump,
    ];
    const layout = measureCells(values);
    ensureSpace(layout.height, true);
    const startY = document.y;
    document.rect(left, startY, tableWidth, layout.height).fill(row.number % 2 === 0 ? "#f4f9fc" : "#ffffff");
    document.strokeColor("#dbe5ec").lineWidth(0.4).rect(left, startY, tableWidth, layout.height).stroke();
    let x = left;
    columnWidths.slice(0, -1).forEach((width) => {
      x += width;
      document.moveTo(x, startY).lineTo(x, startY + layout.height).stroke();
    });
    drawCells(values, layout);
  };
  const drawSummary = () => {
    const summaryItems = [
      ["Sensor", rows[0]?.sensor || "-"],
      ["Jumlah data", String(summary.count)],
      ["Periode pengukuran (WITA)", dateRange],
      ["Rata-rata Soil Moisture", `${displayValue(summary.averageMoisture)}%`],
      ["Rata-rata Temperature", `${displayValue(summary.averageTemperature, 1)} °C`],
      ["Global Soil pH", `${displayValue(globalSoilPh.soilPh)}\nPengukuran terakhir: ${globalSoilPh.measuredAt ? formatWitaTimestamp(globalSoilPh.measuredAt) : "-"}`],
    ];
    const width = tableWidth / 3;
    for (let index = 0; index < summaryItems.length; index += 3) {
      const items = summaryItems.slice(index, index + 3);
      document.font("Helvetica-Bold").fontSize(fontSize);
      const labelHeight = Math.max(...items.map(([label]) => document.heightOfString(label, cellOptions(width))));
      document.font("Helvetica").fontSize(10);
      const valueHeight = Math.max(...items.map(([, value]) => document.heightOfString(value, cellOptions(width))));
      const height = labelHeight + valueHeight + padding * 2 + 5;
      ensureSpace(height);
      const startY = document.y;
      items.forEach(([label, value], column) => {
        const x = left + width * column;
        document.rect(x, startY, width, height).fill("#f4f9fc");
        document.strokeColor("#dbe5ec").lineWidth(0.4).rect(x, startY, width, height).stroke();
        document.font("Helvetica-Bold").fontSize(fontSize).fillColor("#475569").text(label, x + padding, startY + padding, cellOptions(width));
        document.font("Helvetica").fontSize(10).fillColor("#0f172a").text(value, x + padding, startY + padding + labelHeight + 5, cellOptions(width));
      });
      document.x = left;
      document.y = startY + height;
    }
  };
  const drawFooters = () => {
    const { start, count } = document.bufferedPageRange();
    for (let index = start; index < start + count; index += 1) {
      document.switchToPage(index);
      const footerY = document.page.height - 33;
      document.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(left, footerY - 9).lineTo(left + tableWidth, footerY - 9).stroke();
      document.font("Helvetica").fontSize(8).fillColor("#64748b")
        .text("Unggul Monitoring | Laporan dihasilkan oleh Smart Soil Monitoring System", left, footerY, { lineBreak: false });
      // Passing a width enables PDFKit's wrapper even with lineBreak: false,
      // which would add blank pages when writing inside the reserved bottom margin.
      const pageLabel = `Halaman ${index - start + 1} dari ${count}`;
      document.text(pageLabel, left + tableWidth - document.widthOfString(pageLabel), footerY, { lineBreak: false });
    }
  };

  res.type("application/pdf");
  document.pipe(res);
  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text("Laporan Data Monitoring Tanah", left, document.page.margins.top, { width: tableWidth, align: "center" });
  document.y += 4;
  document.fillColor("#475569").font("Helvetica").fontSize(11).text("Smart Soil Monitoring System", { width: tableWidth, align: "center" });
  document.y += 8;
  document.fontSize(fontSize).text(`Periode data: ${dateRange} (WITA)`, { width: tableWidth, align: "center" });
  document.text(`Dibuat pada: ${createdAt}`, { width: tableWidth, align: "center" });
  document.y += 16;
  document.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Ringkasan Data", { width: tableWidth });
  document.y += 6;
  drawSummary();
  document.y += 16;
  ensureSpace(20 + headerLayout.height + 26);
  document.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Data Monitoring", { width: tableWidth });
  document.y += 6;
  drawTableHeader();
  rows.forEach(drawTableRow);
  drawFooters();
  document.end();
}
