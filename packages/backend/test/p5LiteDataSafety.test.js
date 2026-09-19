import test from "node:test";
import assert from "node:assert/strict";
import { parseStrictFiniteNumber } from "../src/utils/strictNumber.js";
import { createRainfallReading, parseRainfallValue, updateRainfallReading } from "../src/services/rainfallService.js";
import { getScopedOperationalDecisions } from "../src/services/chatbotService.js";
import { insertSensorReadings, validateOptionalSensorMetric, validateSoilPh } from "../src/services/sensorService.js";
import { config, supabase } from "../src/config/supabase.js";

const withSupabaseFromMock = async (fromMock, callback) => {
  const originalFrom = supabase.from;
  supabase.from = fromMock;
  try {
    return await callback();
  } finally {
    supabase.from = originalFrom;
  }
};

test("P5 B-01: rainfall hanya menerima angka finite atau string angka non-kosong", () => {
  [[0, 0], ["0", 0], [6.8, 6.8], ["6.8", 6.8], [10, 10], ["10", 10]].forEach(([rawValue, expected]) => {
    assert.equal(parseRainfallValue(rawValue), expected);
  });

  [null, undefined, "", " ", "\t", false, true, NaN, Infinity, -Infinity, {}, [], "abc"].forEach((rawValue) => {
    assert.throws(() => parseRainfallValue(rawValue), { message: "Nilai curah hujan harus berupa angka nol atau lebih." });
  });
});

test("P5 B-01: create dan update menolak rainfall invalid sebelum database write", async () => {
  for (const rawValue of [null, undefined, "", " ", false, true, NaN, Infinity, "abc"]) {
    await assert.rejects(createRainfallReading({ rainfall_value: rawValue }), { message: "Nilai curah hujan harus berupa angka nol atau lebih." });
  }

  for (const rawValue of ["", " ", false, true]) {
    await assert.rejects(updateRainfallReading(1, { rainfall_value: rawValue }), { message: "Nilai curah hujan harus berupa angka nol atau lebih." });
  }

  await assert.rejects(
    updateRainfallReading(1, { measured_at: null }),
    { message: "Tanggal dan waktu pengukuran tidak valid." },
    "rainfall yang tidak dikirim tidak divalidasi sebagai 0",
  );
});

test("P5 H-01/H-02: parser strict menolak coercion boolean dan whitespace", () => {
  assert.equal(parseStrictFiniteNumber(6.5), 6.5);
  assert.equal(parseStrictFiniteNumber("6.5"), 6.5);
  [null, undefined, "", " ", false, true, NaN, Infinity, -Infinity, {}, [], "abc"].forEach((rawValue) => {
    assert.equal(parseStrictFiniteNumber(rawValue), null, String(rawValue));
  });

  assert.deepEqual(validateSoilPh(6.5), { valid: true, value: 6.5 });
  assert.deepEqual(validateSoilPh("6.5"), { valid: true, value: 6.5 });
  assert.deepEqual(validateSoilPh(0), { valid: true, value: 0 });
  assert.deepEqual(validateSoilPh("0"), { valid: true, value: 0 });
  assert.deepEqual(validateSoilPh(null), { valid: true, value: null });
  ["", " ", false, true, NaN, Infinity, -Infinity, {}, [], "abc"].forEach((rawValue) => {
    assert.equal(validateSoilPh(rawValue).valid, false, String(rawValue));
  });

  assert.deepEqual(validateOptionalSensorMetric("28.5", -50, 100), { valid: true, value: 28.5 });
  assert.deepEqual(validateOptionalSensorMetric("72", 0, 100), { valid: true, value: 72 });
  assert.deepEqual(validateOptionalSensorMetric(0, 0, 100), { valid: true, value: 0 });
  assert.deepEqual(validateOptionalSensorMetric("0", 0, 100), { valid: true, value: 0 });
  assert.deepEqual(validateOptionalSensorMetric(null, -50, 100), { valid: true, value: null });
  ["", " ", false, true, NaN, Infinity, -Infinity, {}, [], "abc"].forEach((rawValue) => {
    assert.equal(validateOptionalSensorMetric(rawValue, -50, 100).valid, false, String(rawValue));
    assert.equal(validateOptionalSensorMetric(rawValue, 0, 100).valid, false, String(rawValue));
  });
  assert.equal(validateOptionalSensorMetric(101, -50, 100).valid, false);
  assert.equal(validateOptionalSensorMetric(-1, 0, 100).valid, false);
});

test("P5 H-02: temperature malformed menolak seluruh reading sebelum database write", async () => {
  let databaseMutationCount = 0;

  await withSupabaseFromMock(() => {
    databaseMutationCount += 1;
    throw new Error("Supabase tidak boleh dipanggil untuk DHT invalid.");
  }, async () => {
    const results = await insertSensorReadings({
      sensor1: { kelembaban: 55, soil_ph: 6.5 },
      dht11: { valid: true, suhu: false, kelembaban_udara: 70 },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.match(results[0].error, /temperature dan humidity/);
    assert.equal(databaseMutationCount, 0);
  });
});

test("P5 H-02: humidity malformed menolak seluruh reading sebelum database write", async () => {
  let databaseMutationCount = 0;

  await withSupabaseFromMock(() => {
    databaseMutationCount += 1;
    throw new Error("Supabase tidak boleh dipanggil untuk DHT invalid.");
  }, async () => {
    const results = await insertSensorReadings({
      sensor1: { kelembaban: 55, soil_ph: 6.5 },
      dht11: { valid: true, suhu: 28, kelembaban_udara: "   " },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.match(results[0].error, /temperature dan humidity/);
    assert.equal(databaseMutationCount, 0);
  });
});

test("P5 H-02: DHT optional yang absent tersimpan sebagai null, bukan nol", async () => {
  let upsertCallCount = 0;
  let insertCallCount = 0;
  let insertedRecord = null;

  await withSupabaseFromMock((table) => {
    if (table === "sensors") {
      return {
        upsert: async () => {
          upsertCallCount += 1;
          return { error: null };
        },
      };
    }
    if (table === config.logsTable) {
      return {
        insert: (record) => {
          insertCallCount += 1;
          insertedRecord = record;
          return {
            select: () => ({
              single: async () => ({ data: { id: 1 }, error: null }),
            }),
          };
        },
      };
    }
    throw new Error(`Tabel tidak diharapkan: ${table}`);
  }, async () => {
    const results = await insertSensorReadings({
      sensor1: { kelembaban: 55, soil_ph: 6.5 },
      dht11: { valid: true },
    });

    assert.equal(results[0].success, true);
    assert.equal(upsertCallCount, 1);
    assert.equal(insertCallCount, 1);
    assert.equal(insertedRecord.temperature, null);
    assert.equal(insertedRecord.humidity, null);
  });
});

test("P5 B-02: operational decision chatbot memakai rainfall scoped setiap sensor", async () => {
  const calls = [];
  const rainfallLookup = async (filters) => {
    calls.push(filters);
    if (filters.bedengan === "1") {
      return {
        available: true,
        freshness: "fresh",
        isFresh: true,
        reading: { rainfall_value: 5, unit: "mm", measured_at: "2026-09-20T01:00:00.000Z" },
      };
    }
    if (filters.bedengan === "2") {
      return {
        available: true,
        freshness: "fresh",
        isFresh: true,
        reading: { rainfall_value: 15, unit: "mm", measured_at: "2026-09-20T01:00:00.000Z" },
      };
    }
    return null;
  };
  const sensors = [
    { location: "Nursery A", bedengan: "1", moisture: 20, sensorHealth: "online" },
    { location: "Nursery A", bedengan: "2", moisture: 20, sensorHealth: "online" },
  ];

  const decisions = await getScopedOperationalDecisions(sensors, rainfallLookup);

  assert.deepEqual(calls, [
    { nursery: "Nursery A", bedengan: "1" },
    { nursery: "Nursery A", bedengan: "2" },
  ]);
  assert.equal(decisions[0].rainfall.value, 5);
  assert.equal(decisions[0].decision.code, "water");
  assert.equal(decisions[1].rainfall.value, 15);
  assert.equal(decisions[1].decision.code, "no_watering");
});

test("P5 B-02: rainfall bedengan lain atau metadata scope tidak menjadi fallback", async () => {
  const calls = [];
  const rainfallLookup = async (filters) => {
    calls.push(filters);
    return filters.bedengan === "1"
      ? { available: true, freshness: "fresh", isFresh: true, reading: { rainfall_value: 5, unit: "mm", measured_at: "2026-09-20T01:00:00.000Z" } }
      : null;
  };
  const decisions = await getScopedOperationalDecisions([
    { location: "Nursery A", bedengan: "1", moisture: 20, sensorHealth: "online" },
    { location: "Nursery A", bedengan: "2", moisture: 20, sensorHealth: "online" },
    { location: null, bedengan: "3", moisture: 20, sensorHealth: "online" },
  ], rainfallLookup);

  assert.equal(calls.length, 2);
  assert.equal(decisions[0].decision.code, "water");
  assert.equal(decisions[1].rainfall.freshness, "missing");
  assert.equal(decisions[1].decision.code, "rainfall_unavailable");
  assert.equal(decisions[2].rainfall.freshness, "missing");
  assert.equal(decisions[2].rainfallScope.available, false);
  assert.equal(decisions[2].decision.code, "rainfall_unavailable");
});
