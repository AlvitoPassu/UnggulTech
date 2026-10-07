import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { reportRows, sendCsv, sendPdf, sendXlsx } from "../src/services/reportService.js";

const sampleRows = reportRows([{
  id: 1,
  sensor_id: 1,
  moisture: 62,
  soil_ph: 6.4,
  temperature: 28,
  humidity: 70,
  created_at: "2026-09-25T08:00:00.000Z",
}]);

const globalSoilPh = { soilPh: 6.4, measuredAt: "2026-09-25T08:00:00.000Z", status: "active", isActive: true };

const exportPdf = async (rows, ph = globalSoilPh, endDate = "2026-09-25") => {
  const response = new PassThrough();
  response.type = (type) => { assert.equal(type, "application/pdf"); return response; };
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    response.on("finish", resolve);
    response.on("error", reject);
  });
  sendPdf(response, rows, "2026-09-25", endDate, ph);
  await finished;
  return Buffer.concat(chunks);
};

// Inspect the actual PDFKit output, including compressed streams and positioned text.
// This intentionally covers only the standard-font PDFs produced by this exporter.
const inspectPdf = (buffer) => {
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  const raw = buffer.toString("latin1");
  assert.match(raw, /%%EOF/);
  const objects = new Map([...raw.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map((match) => [match[1], match[2]]));
  const pagesObject = [...objects.values()].find((value) => /\/Type \/Pages\b/.test(value));
  const pageIds = [...pagesObject.match(/\/Kids \[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((match) => match[1]);
  assert.equal(pageIds.length, Number(pagesObject.match(/\/Count (\d+)/)[1]));
  return pageIds.map((id) => {
    const page = objects.get(id);
    const [, width, height] = page.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).map(Number);
    const streamObject = objects.get(page.match(/\/Contents (\d+) 0 R/)[1]);
    const stream = streamObject.match(/stream\n([\s\S]*?)\nendstream/)[1];
    const content = inflateSync(Buffer.from(stream, "latin1")).toString();
    const texts = [...content.matchAll(/BT\n1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\/(F\d+) ([\d.]+) Tf\n\[([^\]]*)\] TJ\nET/g)].map((match) => ({
      x: Number(match[1]), y: height - Number(match[2]) - Number(match[4]) * 0.718,
      font: match[3], size: Number(match[4]),
      text: [...match[5].matchAll(/<([a-f\d]+)>/gi)].map((hex) => Buffer.from(hex[1], "hex").toString("latin1")).join(""),
    }));
    assert.ok(texts.length > 0);
    const tableRects = [...content.matchAll(/36 ([\d.]+) ([\d.]+) ([\d.]+) re/g)]
      .filter((match) => Math.abs(Number(match[2]) - (width - 72)) < 0.01)
      .map((match) => ({ y: Number(match[1]), height: Number(match[3]) }));
    const columnEdges = [...new Set([...content.matchAll(/([\d.]+) ([\d.]+) m\n\1 ([\d.]+) l\nS/g)]
      .map((match) => Number(match[1])))].sort((a, b) => a - b);
    return { width, height, content, texts, tableRects, columnEdges };
  });
};

const compact = (value) => String(value).replace(/\s/g, "");
const expectedRow = (row) => [row.number, row.timestamp, row.sensor, row.bedengan,
  row.moisture == null || row.moisture === "" ? "-" : row.moisture.toFixed(2),
  row.temperature == null || row.temperature === "" ? "-" : row.temperature.toFixed(1),
  row.humidity == null || row.humidity === "" ? "-" : row.humidity.toFixed(2), row.status, row.pump,
].map(compact).join("");

const assertPdfLayout = (pages, rows) => {
  const metrics = new PDFDocument({ autoFirstPage: false });
  const actualRows = [];
  pages.forEach((page, index) => {
    const footer = page.texts.filter(({ y }) => y >= page.height - 56);
    assert.deepEqual(footer.map(({ text }) => text), [
      "Unggul Monitoring | Laporan dihasilkan oleh Smart Soil Monitoring System",
      `Halaman ${index + 1} dari ${pages.length}`,
    ]);
    page.texts.forEach((item) => {
      metrics.font(item.font === "F2" ? "Helvetica-Bold" : "Helvetica").fontSize(item.size);
      assert.ok(item.x >= 36 - 0.01);
      assert.ok(item.x + metrics.widthOfString(item.text) <= page.width - 36 + 0.01, `text exceeds right margin: ${item.text}`);
      assert.ok(item.y >= 36 - 0.01);
      assert.ok(item.y + item.size < page.height - 20);
    });
    page.tableRects.forEach((rect) => assert.ok(rect.y + rect.height <= page.height - 56 + 0.01, "table overlaps footer"));
    const headerIndex = page.texts.findIndex(({ text }) => text === "No");
    if (headerIndex < 0) return; // A very long summary can occupy its own page.
    const tableText = page.texts.slice(headerIndex).filter(({ y }) => y < page.height - 56);
    ["No", "Waktu", "(WITA)", "Sensor", "Bedengan", "Soil Moisture", "Temperature", "(°C)", "Humidity", "Status", "Pump"]
      .forEach((heading) => assert.ok(tableText.some(({ text }) => text === heading), `missing header: ${heading}`));
    assert.match(page.content, /0\.11372549019607843 0\.6666666666666666 0\.8745098039215686 scn/);
    tableText.forEach((item) => {
      assert.ok(item.size >= 9);
      assert.ok(page.tableRects.some((rect) => item.y >= rect.y && item.y + item.size <= rect.y + rect.height), `text outside row: ${item.text}`);
    });
    const rowStarts = tableText.map((item, position) => /^\d+$/.test(item.text) && item.x < 76 ? position : -1).filter((position) => position >= 0);
    rowStarts.forEach((position, rowIndex) => {
      const cells = tableText.slice(position, rowStarts[rowIndex + 1] ?? tableText.length);
      assert.equal(page.columnEdges.length, 8);
      const edges = [36, ...page.columnEdges, page.width - 36];
      cells.forEach((item) => {
        metrics.font("Helvetica").fontSize(item.size);
        const column = edges.findIndex((edge, index) => item.x >= edge && item.x < edges[index + 1]);
        assert.ok(column >= 0);
        assert.ok(item.x >= edges[column] + 6 - 0.01, "text exceeds left cell padding");
        assert.ok(item.x + metrics.widthOfString(item.text) <= edges[column + 1] - 6 + 0.01, `text exceeds column: ${item.text}`);
      });
      actualRows.push(cells.map(({ text }) => compact(text)).join(""));
    });
  });
  metrics.end();
  assert.deepEqual(actualRows, rows.map(expectedRow), "all row values and their order must be preserved on a single page per row");
};

test("PDF keeps summary statistics, units, pH metadata, and missing values", async () => {
  const rows = [sampleRows[0], { ...sampleRows[0], number: 2, moisture: 38, temperature: 22 },
    { ...sampleRows[0], number: 3, timestamp: "", moisture: null, temperature: undefined, humidity: "", sensor: "", bedengan: "", pump: "" }];
  const original = structuredClone(rows);
  const pages = inspectPdf(await exportPdf(rows));
  assert.equal(pages.length, 1);
  assertPdfLayout(pages, rows);
  const text = pages[0].texts.map(({ text }) => text).join(" ");
  ["Laporan Data Monitoring Tanah", "Smart Soil Monitoring System", "Jumlah data", "Periode pengukuran (WITA)",
    "Rata-rata Soil Moisture", "50.00%", "Rata-rata Temperature", "25.0 °C", "Global Soil pH", "6.40", "25/09/2026, 16.00.00 WITA", "Dibuat pada:"]
    .forEach((value) => assert.ok(text.includes(value), `missing summary value: ${value}`));
  assert.deepEqual(rows, original);
});

test("PDF paginates 2000 rows with repeated headers and correct total page count", async () => {
  const rows = Array.from({ length: 2000 }, (_, index) => ({ ...sampleRows[0], number: index + 1, pump: index % 2 ? "On" : "Off" }));
  const pages = inspectPdf(await exportPdf(rows, globalSoilPh, "2026-10-08"));
  assert.ok(pages.length > 100);
  pages.forEach((page) => { assert.equal(page.width, 841.89); assert.equal(page.height, 595.28); });
  assertPdfLayout(pages, rows);
});

test("PDF wraps long text and unbroken identifiers without truncating or splitting rows", async () => {
  const rows = Array.from({ length: 16 }, (_, index) => ({ ...sampleRows[0], number: index + 1,
    sensor: "Sensor nursery utara dengan nama panjang untuk verifikasi pembungkusan teks lengkap",
    bedengan: "Bedengan-" + "0123456789".repeat(8), pump: "Pompa aktif dengan keterangan panjang dan tetap terbaca", humidity: null,
  }));
  assertPdfLayout(inspectPdf(await exportPdf(rows, {})), rows);
});

test("PDF keeps a row taller than an A4 page intact at a readable font size", async () => {
  const rows = [{ ...sampleRows[0], sensor: "Sensor sangat panjang ".repeat(100), number: 1 }];
  const pages = inspectPdf(await exportPdf(rows));
  assert.ok(pages.some((page) => page.height > 595.28));
  assertPdfLayout(pages, rows);
});

test("PDF with no rows and no pH still opens with one page and a complete summary", async () => {
  const pages = inspectPdf(await exportPdf([], {}));
  assert.equal(pages.length, 1);
  assertPdfLayout(pages, []);
  const text = pages[0].texts.map(({ text }) => text);
  assert.ok(text.includes("Jumlah data"));
  assert.ok(text.includes("0"));
  assert.ok(text.includes("Global Soil pH"));
  assert.ok(text.includes("Pengukuran terakhir: -"));
});

test("exports keep global pH metadata separate from moisture rows", { concurrency: false }, async () => {
  assert.equal(Object.hasOwn(sampleRows[0], "ph"), false);

  let csv = "";
  sendCsv({ type: () => ({ send: (value) => { csv = value; } }) }, sampleRows, globalSoilPh);
  assert.match(csv, /Global Soil pH/);
  assert.doesNotMatch(csv, /"Soil pH"/);

  let xlsxBuffer;
  await sendXlsx({ type: () => ({ send: (value) => { xlsxBuffer = value; } }) }, sampleRows, "2026-09-25", "2026-09-25", globalSoilPh);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);
  assert.equal(workbook.getWorksheet("Ringkasan").getCell("A7").value, "Global Soil pH");

  const pdfResponse = new PassThrough();
  pdfResponse.type = () => pdfResponse;
  const chunks = [];
  pdfResponse.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => pdfResponse.on("finish", resolve));
  sendPdf(pdfResponse, sampleRows, "2026-09-25", "2026-09-25", globalSoilPh);
  await finished;
  assert.ok(Buffer.concat(chunks).subarray(0, 4).equals(Buffer.from("%PDF")));
});
