import test from "node:test";
import assert from "node:assert/strict";
import { getRecommendationDecision } from "../src/domain/recommendationDecisionEngine.js";

const decide = (moisture, rainfall = { value: 5, freshness: "fresh", unit: "mm" }, sensorHealth = "online") => (
  getRecommendationDecision({ moisture, sensorHealth, rainfall })
);

test("matrix P4B mengikuti batas moisture dan rainfall", () => {
  const cases = [
    [20, 0, "water"], [20, 9.99, "water"], [20, 10, "no_watering"], [20, 10.01, "no_watering"],
    [30, 9.99, "water"], [30, 10, "no_watering"],
    [30.01, 9.99, "inspect_bed"], [30.01, 10, "no_watering"],
    [35, 5, "inspect_bed"], [35, 10, "no_watering"],
    [70, 9.99, "inspect_bed"], [70, 10, "no_watering"],
    [70.01, 9.99, "inspect_bed"], [70.01, 10, "no_watering"],
    [100, 9.99, "inspect_bed"], [100, 10, "no_watering"],
  ];

  cases.forEach(([moisture, rainfall, expected]) => {
    assert.equal(decide(moisture, { value: rainfall, freshness: "fresh", unit: "mm" }).decision.code, expected, `${moisture} / ${rainfall}`);
  });
});

test("condition dan action tetap terpisah", () => {
  const result = decide(20, { value: 15, freshness: "fresh", unit: "mm" });
  assert.deepEqual(result.moisture, { value: 20, condition: "dry", needsAttention: true, legacyStatus: "Low" });
  assert.equal(result.decision.code, "no_watering");
});

test("stale dan missing tidak masuk ke decision matrix", () => {
  assert.equal(decide(20, { value: 5, freshness: "stale", unit: "mm" }).decision.code, "rainfall_unavailable");
  assert.equal(decide(20, { freshness: "missing", unit: "mm" }).decision.code, "rainfall_unavailable");
});

test("health sensor menahan keputusan operasional", () => {
  assert.equal(decide(20, { value: 5, freshness: "fresh", unit: "mm" }, "online").decision.code, "water");
  assert.equal(decide(20, { value: 5, freshness: "fresh", unit: "mm" }, "stale").decision.code, "sensor_unavailable");
  assert.equal(decide(20, { value: 5, freshness: "fresh", unit: "mm" }, "offline").decision.code, "sensor_unavailable");
});

test("moisture invalid tidak pernah membuat action matrix", () => {
  [null, undefined, "", "   ", true, false, NaN, Infinity, -Infinity, -1, 101].forEach((moisture) => {
    assert.equal(decide(moisture).decision.code, "sensor_unavailable", String(moisture));
  });
});

test("rainfall invalid tidak diperlakukan sebagai nol", () => {
  [null, undefined, "", " ", true, false, NaN, Infinity, -Infinity, -1].forEach((value) => {
    assert.equal(decide(20, { value, freshness: "fresh", unit: "mm" }).decision.code, "rainfall_unavailable", String(value));
  });
  assert.equal(decide(20, { value: 0, freshness: "fresh", unit: "mm" }).decision.code, "water");
});

test("durasi dan jadwal hanya tersedia untuk water", () => {
  const water = decide(20, { value: 5, freshness: "fresh", unit: "mm" }).decision;
  assert.equal(water.durationMinutes, 30);
  assert.deepEqual(water.schedule, ["pagi", "sore"]);

  [
    decide(20, { value: 15, freshness: "fresh", unit: "mm" }).decision,
    decide(35, { value: 5, freshness: "fresh", unit: "mm" }).decision,
    decide(20, { value: 5, freshness: "stale", unit: "mm" }).decision,
    decide(20, { value: 5, freshness: "fresh", unit: "mm" }, "offline").decision,
  ].forEach((decision) => {
    assert.equal(decision.durationMinutes, null);
    assert.deepEqual(decision.schedule, []);
  });
});
