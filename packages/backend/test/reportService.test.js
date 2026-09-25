import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
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
