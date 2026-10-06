import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackDecisionNarrative,
  buildFallbackGeneralRecommendations,
  generateRecommendationNarratives,
  parseGeneralRecommendationResponse,
} from "../src/services/recommendationNarrativeService.js";

const recommendationContext = (overrides = {}) => ({
  decision: {
    code: "inspect_bed",
    title: "Periksa Kondisi Bedengan Terlebih Dahulu",
    reason: "Kelembaban tanah basah dan curah hujan aktual hari ini di bawah 10 mm.",
  },
  moisture: { value: 80, condition: "wet" },
  sensorHealth: "online",
  rainfall: { value: 5, unit: "mm", freshness: "fresh" },
  ...overrides,
});

const llmRecommendations = () => {
  const description = "Kondisi yang terbaca perlu digunakan sebagai dasar tindakan saat ini. Lakukan pemeriksaan sesuai keputusan operasional dan bandingkan dengan kondisi media di lapangan. Pantau pembacaan sensor setelah pemeriksaan untuk menentukan tindak lanjut yang aman.";
  return [
    `Periksa kondisi media\n\n${description}`,
    `Pantau pembacaan sensor\n\n${description}`,
    `Evaluasi data berikutnya\n\n${description}`,
  ];
};

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

test("Gemini yang berhasil menghasilkan narrative tanpa mengganti keputusan utama", async () => {
  const context = recommendationContext();
  const originalDecision = structuredClone(context.decision);
  const decisionNarrative = "Kelembaban tanah berada pada kondisi basah dan curah hujan aktual tersedia. Sistem meminta pemeriksaan bedengan karena pembacaan ini perlu diverifikasi sebelum tindakan lain dilakukan. Periksa kelembaban media secara langsung dan bandingkan dengan sensor, lalu pantau pembacaan berikutnya sebelum menentukan tindakan lanjutan.";
  const result = await generateRecommendationNarratives(context, {
    apiKey: "test-key",
    request: async () => ({ text: JSON.stringify({ decisionNarrative, recommendations: llmRecommendations() }) }),
  });

  assert.equal(result.decisionNarrative, decisionNarrative);
  assert.equal(result.generalRecommendations.length, 3);
  assert.deepEqual(context.decision, originalDecision);
});

test("narasi Gemini yang melarang penyiraman tetap konsisten untuk no_watering", async () => {
  const context = recommendationContext({
    decision: { code: "no_watering", title: "Tidak Perlu Penyiraman" },
    moisture: { value: 55, condition: "normal" },
  });
  const decisionNarrative = "Kelembaban tanah berada pada kondisi normal dan curah hujan aktual tersedia. Sistem menetapkan keputusan ini karena kondisi media belum memerlukan tambahan air. Jangan lakukan penyiraman tambahan saat ini; pantau pembacaan kelembaban dan curah hujan berikutnya sebelum menentukan tindakan lanjutan.";
  const result = await generateRecommendationNarratives(context, {
    apiKey: "test-key",
    request: async () => ({ text: JSON.stringify({ decisionNarrative, recommendations: llmRecommendations() }) }),
  });

  assert.equal(result.decisionNarrative, decisionNarrative);
});

test("response Gemini invalid menggunakan fallback narrative yang informatif", async () => {
  const context = recommendationContext();
  const result = await generateRecommendationNarratives(context, {
    apiKey: "test-key",
    request: async () => ({ text: "bukan JSON" }),
  });

  assert.equal(result.decisionNarrative, buildFallbackDecisionNarrative(context));
  assert.match(result.decisionNarrative, /Periksa langsung kelembaban media/i);
  assert.equal(result.generalRecommendations.length, 3);
});

test("timeout Gemini menggunakan fallback tanpa mengosongkan narrative", async () => {
  const context = recommendationContext({
    decision: { code: "no_watering", title: "Tidak Perlu Penyiraman" },
    moisture: { value: 55, condition: "normal" },
  });
  const result = await generateRecommendationNarratives(context, {
    apiKey: "test-key",
    request: () => new Promise(() => {}),
    timeoutMs: 5,
  });

  assert.equal(result.decisionNarrative, buildFallbackDecisionNarrative(context));
  assert.match(result.decisionNarrative, /penambahan air belum diperlukan/i);
});

test("Gemini tidak tersedia menggunakan fallback untuk kondisi data berbeda", async () => {
  const scenarios = [
    recommendationContext({ decision: { code: "water", title: "Lakukan Penyiraman" }, moisture: { value: 20, condition: "dry" } }),
    recommendationContext({ decision: { code: "no_watering", title: "Tidak Perlu Penyiraman" }, moisture: { value: 55, condition: "normal" }, rainfall: { freshness: "missing", unit: "mm" }, weather: null }),
    recommendationContext({ decision: { code: "sensor_unavailable", title: "Data Sensor Tidak Tersedia" }, sensorHealth: "offline", weather: { description: "Berawan" } }),
  ];

  for (const context of scenarios) {
    const result = await generateRecommendationNarratives(context, { apiKey: null });
    assert.equal(result.decisionNarrative, buildFallbackDecisionNarrative(context));
    assert.ok(result.decisionNarrative.length >= 160);
    assert.ok(Array.isArray(result.generalRecommendations));
  }
});

test("fallback mempertahankan konteks rainfall dan cuaca hanya ketika tersedia", () => {
  const withWeather = buildFallbackGeneralRecommendations(recommendationContext({
    decision: { code: "no_watering", title: "Tidak Perlu Penyiraman" },
    weather: { description: "Berawan" },
  }));
  const withoutWeather = buildFallbackGeneralRecommendations(recommendationContext({
    decision: { code: "no_watering", title: "Tidak Perlu Penyiraman" },
    rainfall: { freshness: "missing", unit: "mm" },
    weather: null,
  }));

  assert.match(withWeather.at(-1), /Prakiraan cuaca yang tersedia menunjukkan Berawan/);
  assert.match(withoutWeather[0], /curah hujan aktual belum tersedia/i);
  assert.equal(withoutWeather.some((item) => /Prakiraan cuaca/.test(item)), false);
});

test("narasi LLM yang bertentangan dengan keputusan inspeksi ditolak", async () => {
  const context = recommendationContext();
  const result = await generateRecommendationNarratives(context, {
    apiKey: "test-key",
    request: async () => ({
      text: JSON.stringify({
        decisionNarrative: "Kelembaban tanah perlu diperhatikan berdasarkan data yang tersedia saat ini. Lakukan penyiraman sekarang agar media segera mendapatkan tambahan air. Pantau kembali sensor setelah tindakan tersebut untuk menentukan kebutuhan berikutnya.",
        recommendations: llmRecommendations(),
      }),
    }),
  });

  assert.equal(result.decisionNarrative, buildFallbackDecisionNarrative(context));
});
