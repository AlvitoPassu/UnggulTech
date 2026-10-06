import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackGeneralRecommendations, parseGeneralRecommendationResponse } from "../src/services/recommendationNarrativeService.js";

test("fallback rekomendasi umum menjelaskan tindakan penyiraman dengan data yang tersedia", () => {
  const recommendations = buildFallbackGeneralRecommendations({
    decision: { code: "water" },
    moisture: { value: 20, condition: "dry" },
    sensorHealth: "online",
    rainfall: { value: 5, unit: "mm", freshness: "fresh" },
  });

  assert.equal(recommendations.length, 3);
  assert.match(recommendations[0], /^Lakukan penyiraman sesuai keputusan operasional\n\n/);
  assert.match(recommendations[0], /20,0%/);
  assert.match(recommendations[0], /5,0 mm/);
  assert.ok(recommendations.every((item) => item.split("\n").filter(Boolean).length >= 2));
});

test("fallback rekomendasi umum meminta verifikasi saat data keputusan belum tersedia", () => {
  const recommendations = buildFallbackGeneralRecommendations({
    decision: { code: "rainfall_unavailable" },
    moisture: { value: 55, condition: "normal" },
    sensorHealth: "online",
    rainfall: { freshness: "missing", unit: "mm" },
  });

  assert.equal(recommendations.length, 3);
  assert.match(recommendations[0], /Pastikan data utama tersedia/);
  assert.match(recommendations[0], /curah hujan aktual belum tersedia/i);
});

test("parser menerima JSON LLM dengan array string tanpa mengubah kontrak respons", () => {
  const description = "Kondisi ini didasarkan pada pembacaan data yang tersedia saat ini. Lakukan pemeriksaan lapangan sebelum menentukan tindakan berikutnya dan pantau pembacaan sensor setelah pemeriksaan dilakukan.";
  const result = parseGeneralRecommendationResponse(JSON.stringify({
    recommendations: [
      `Periksa kondisi media\n\n${description}`,
      `Pantau pembacaan sensor\n\n${description}`,
      `Evaluasi data berikutnya\n\n${description}`,
    ],
  }));

  assert.equal(result?.length, 3);
  assert.match(result[0], /^Periksa kondisi media\n\n/);
});
