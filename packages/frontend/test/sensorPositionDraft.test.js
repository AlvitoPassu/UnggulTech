import assert from "node:assert/strict";
import test from "node:test";
import { coordinateMaximum, draftPosition, parseDraftCoordinate, stepDraftCoordinate } from "../src/components/Sensor/sensorPositionDraft.js";

test("manual draft coordinates accept every integer within the 10 × 100 map", () => {
  for (let row = 1; row <= 10; row++) {
    for (let column = 1; column <= 100; column++) {
      assert.deepEqual(draftPosition({ row: String(row), column: String(column) }), { row, column });
    }
  }
});

test("invalid manual drafts never yield a preview, without partial parsing or coercion", () => {
  for (const [field, maximum] of Object.entries(coordinateMaximum)) {
    for (const value of ["", " ", "0", "-1", String(maximum + 1), "1.5", "1.0", "1e0", "+1", "1x", "abc", "0x1", "1 0", " 1", "1 ", null, undefined, true, 1, {}, []]) {
      assert.equal(parseDraftCoordinate(value, maximum), null, `${field}=${String(value)}`);
      assert.equal(draftPosition({ row: "1", column: "1", [field]: value }), null);
    }
  }
});

test("steppers stay within bounds, allow the first position and preserve invalid text for correction", () => {
  for (const maximum of Object.values(coordinateMaximum)) {
    assert.equal(stepDraftCoordinate("", 1, maximum), "1");
    assert.equal(stepDraftCoordinate("", -1, maximum), "");
    for (let value = 1; value <= maximum; value++) {
      assert.equal(stepDraftCoordinate(String(value), -1, maximum), String(Math.max(1, value - 1)));
      assert.equal(stepDraftCoordinate(String(value), 1, maximum), String(Math.min(maximum, value + 1)));
    }
    for (const invalid of ["0", "-1", "1.5", "1e0", "abc", String(maximum + 1)]) {
      assert.equal(stepDraftCoordinate(invalid, 1, maximum), invalid);
      assert.equal(stepDraftCoordinate(invalid, -1, maximum), invalid);
    }
  }
});
