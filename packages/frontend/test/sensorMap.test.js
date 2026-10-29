import assert from "node:assert/strict";
import test from "node:test";
import { BED_MAP_HEIGHT, BED_MAP_WIDTH, BED_NUMBERS, SEEDLING_POINTS, getBedNumber, getMapLocation, isOutsideMap, sensorsForBed, hasPosition, pointCoordinates, formatTimestamp } from "../src/components/Sensor/sensorMapModel.js";

test("single map location comes from registry metadata without merging nurseries or inventing sensors", () => {
  const sensors = [
    { id: 991, bedengan: "1", location: null },
    ...Array.from({ length: 6 }, (_, index) => ({ id: 701 + index, bedengan: String(index + 1), location: " Lokasi sebenarnya " })),
    { id: 992, bedengan: "1", location: "Nursery lain" },
  ];
  assert.equal(getMapLocation(sensors), "Lokasi sebenarnya");
  assert.equal(getMapLocation([...sensors].reverse()), "Lokasi sebenarnya");
  assert.deepEqual(sensors.filter((sensor) => isOutsideMap(sensor, getMapLocation(sensors))).map((sensor) => sensor.id), [991, 992]);
  for (const bed of BED_NUMBERS) {
    assert.deepEqual(sensorsForBed(sensors, getMapLocation(sensors), bed).map((sensor) => sensor.id), bed <= 6 ? [700 + bed] : []);
  }
  assert.equal(getMapLocation([]), "");
  assert.equal(getMapLocation([{ location: null }]), null);
});

test("layout contains B1–B60 and exactly 1000 distinct seedling positions", () => {
  assert.equal(BED_NUMBERS.length, 60);
  assert.equal(BED_NUMBERS[0], 1);
  assert.equal(BED_NUMBERS[59], 60);
  assert.equal(SEEDLING_POINTS.length, 1000);
  assert.equal(new Set(SEEDLING_POINTS.map((point) => JSON.stringify(pointCoordinates(point)))).size, 1000);
  assert.deepEqual(SEEDLING_POINTS[0], { row: 1, column: 1 });
  assert.deepEqual(SEEDLING_POINTS.at(-1), { row: 10, column: 100 });
  assert.equal(new Set(SEEDLING_POINTS.map(({ row }) => row)).size, 10);
  assert.equal(new Set(SEEDLING_POINTS.map(({ column }) => column)).size, 100);
  assert.equal(new Set(SEEDLING_POINTS.map((point) => pointCoordinates(point).x)).size, 100);
  assert.equal(new Set(SEEDLING_POINTS.map((point) => pointCoordinates(point).y)).size, 10);
  for (const point of SEEDLING_POINTS) {
    const { x, y } = pointCoordinates(point);
    // Entire 44px marker remains inside the map at its minimum 300px width.
    assert.ok(x / BED_MAP_WIDTH * 300 >= 22);
    assert.ok((BED_MAP_WIDTH - x) / BED_MAP_WIDTH * 300 >= 22);
    assert.ok(y / BED_MAP_WIDTH * 300 >= 22);
    assert.ok((BED_MAP_HEIGHT - y) / BED_MAP_WIDTH * 300 >= 22);
  }
});

test("all rows 1–10, columns 1–100 and the four corners are valid without coercion", () => {
  const sensor = { id: 701, bedengan: 1, location: "A" };
  for (let row = 1; row <= 10; row++) {
    for (let column = 1; column <= 100; column++) {
      assert.equal(hasPosition({ ...sensor, placement: { row, column } }), true);
    }
  }
  for (const [row, column, expected] of [[1, 1, { x: 80, y: 70 }], [1, 100, { x: 800, y: 70 }], [10, 1, { x: 80, y: 370 }], [10, 100, { x: 800, y: 370 }]]) {
    assert.deepEqual(pointCoordinates({ row, column }), expected);
  }
  for (const field of ["row", "column"]) {
    for (const value of [0, -1, field === "row" ? 11 : 101, 1.5, NaN, Infinity, -Infinity, "1", "1.0", "abc", "1a", "", " ", null, undefined, true, false, [], {}]) {
      assert.equal(hasPosition({ ...sensor, placement: { row: 1, column: 1, [field]: value } }), false, `${field}=${String(value)}`);
    }
  }
});

test("matching uses actual bed and nursery, never sensor ID or partial parsing", () => {
  const sensors = [
    { id: 701, bedengan: "B26", location: "A" },
    { id: 26, bedengan: "27", location: "A" },
    { id: 702, bedengan: "Bedengan 26", location: "B" },
    { id: 703, bedengan: "26", location: null },
  ];
  assert.deepEqual(sensorsForBed(sensors, "A", 26).map((item) => item.id), [701]);
  assert.deepEqual(sensorsForBed(sensors, "B", 26).map((item) => item.id), [702]);
  assert.deepEqual(sensorsForBed(sensors, null, 26).map((item) => item.id), [703]);
  assert.deepEqual(sensorsForBed(sensors, "", 26), []);
  for (const value of [null, "", "26wrong", "26.1", 0, 61]) assert.equal(getBedNumber(value), null);
});

test("explicit NULL supports markers while missing/empty locations and invalid positions do not", () => {
  const sensor = { id: 701, bedengan: 26, location: "A", placement: { row: 10, column: 100 } };
  assert.equal(hasPosition(sensor), true);
  assert.equal(hasPosition({ ...sensor, location: null }), true);
  for (const location of [undefined, "", " \t\ufeff", 1, false, {}, []]) {
    assert.equal(hasPosition({ ...sensor, location }), false);
    assert.equal(isOutsideMap({ ...sensor, location }, null), true);
  }
  for (const value of [{ ...sensor, bedengan: 99 }, { ...sensor, placement: null }, { ...sensor, placement: { row: 11, column: 40 } }]) assert.equal(hasPosition(value), false);
  assert.match(formatTimestamp("2026-10-27T00:00:00Z"), /08[.:]00[.:]00 WITA/);
  assert.equal(formatTimestamp(null), "Belum ada data");
});

test("six NULL-location registry sensors map to their real beds without changing metadata", () => {
  const sensors = Array.from({ length: 6 }, (_, i) => Object.freeze({ id: String(i + 1), location: null, bedengan: `Bedengan ${i + 1}` }));
  assert.equal(getMapLocation(sensors), null);
  for (const bed of BED_NUMBERS) assert.deepEqual(sensorsForBed(sensors, null, bed), bed <= 6 ? [sensors[bed - 1]] : []);
  assert.ok(sensors.every((sensor) => !isOutsideMap(sensor, null) && sensor.location === null));
  assert.deepEqual(sensorsForBed([...sensors, { id: "7", location: "null", bedengan: "1" }], null, 1), [sensors[0]]);
});
