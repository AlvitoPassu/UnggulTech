import assert from "node:assert/strict";
import test from "node:test";
import { supabase } from "../src/config/supabase.js";
import {
  PH_ACTIVE_THRESHOLD_SECONDS,
  createSoilPhReading,
  getSoilPhHistory,
  getLatestSoilPh,
  getSoilPhStatus,
} from "../src/services/soilPhService.js";
import { insertSensorReadings } from "../src/services/sensorService.js";

const withSupabaseFromMock = async (fromMock, callback) => {
  const originalFrom = supabase.from;
  supabase.from = fromMock;
  try {
    await callback();
  } finally {
    supabase.from = originalFrom;
  }
};

test("pH ingestion writes one global reading and never a moisture reading", { concurrency: false }, async () => {
  let inserted;
  await withSupabaseFromMock((table) => {
    assert.equal(table, "soil_ph_readings");
    return {
      insert: (record) => {
        inserted = record;
        return {
          select: () => ({
            single: async () => ({ data: { id: 7, ph_value: 6.4, measured_at: "2026-09-25T08:00:00.000Z" }, error: null }),
          }),
        };
      },
    };
  }, async () => {
    const reading = await createSoilPhReading({ soil_ph: 6.4 });
    assert.deepEqual(inserted, { ph_value: 6.4 });
    assert.equal(reading.soilPh, 6.4);
  });
});

test("invalid pH does not write or replace a valid reading", { concurrency: false }, async () => {
  let called = false;
  await withSupabaseFromMock(() => {
    called = true;
    throw new Error("database must not be called");
  }, async () => {
    await assert.rejects(() => createSoilPhReading({ soil_ph: 14.1 }), /rentang 0-14/);
  });
  assert.equal(called, false);
});

test("legacy pH broadcast payload is rejected by the moisture endpoint before any insert", { concurrency: false }, async () => {
  const result = await insertSensorReadings({ sensor1: { kelembaban: 0, soil_ph: 6.4, status: "pH Monitor" } });
  assert.equal(result[0].success, false);
  assert.match(result[0].error, /endpoint pH terpisah/);
});

test("latest valid pH stays available after its active threshold expires", { concurrency: false }, async () => {
  const measuredAt = "2026-09-25T08:00:00.000Z";
  const now = new Date(measuredAt).getTime() + (PH_ACTIVE_THRESHOLD_SECONDS + 1) * 1000;
  await withSupabaseFromMock((table) => {
    assert.equal(table, "soil_ph_readings");
    return {
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: { id: 8, ph_value: 6.6, measured_at: measuredAt }, error: null }),
          }),
        }),
      }),
    };
  }, async () => {
    const reading = await getLatestSoilPh(now);
    assert.equal(reading.soilPh, 6.6);
    assert.equal(reading.measuredAt, measuredAt);
    assert.equal(reading.status, "inactive");
    assert.equal(reading.isActive, false);
  });
});

test("pH status is active only within the independent pH threshold", () => {
  const now = new Date("2026-09-25T08:00:00.000Z").getTime();
  assert.deepEqual(getSoilPhStatus("2026-09-25T08:00:00.000Z", now), { status: "active", isActive: true });
  assert.deepEqual(getSoilPhStatus(null, now), { status: "no_data", isActive: false });
});

test("latest pH returns no_data when PostgREST has not cached the pH table", { concurrency: false }, async () => {
  await withSupabaseFromMock((table) => {
    assert.equal(table, "soil_ph_readings");
    return {
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "PGRST205", message: "Could not find the table 'public.soil_ph_readings' in the schema cache" },
            }),
          }),
        }),
      }),
    };
  }, async () => {
    assert.deepEqual(await getLatestSoilPh(), {
      soilPh: null,
      measuredAt: null,
      status: "no_data",
      isActive: false,
    });
  });
});

test("pH history returns empty when PostgREST has not cached the pH table", { concurrency: false }, async () => {
  await withSupabaseFromMock((table) => {
    assert.equal(table, "soil_ph_readings");
    return {
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: null,
            error: { code: "PGRST205", message: "Could not find the table 'public.soil_ph_readings' in the schema cache" },
          }),
        }),
      }),
    };
  }, async () => {
    assert.deepEqual(await getSoilPhHistory(), []);
  });
});

test("unknown pH read errors still propagate", { concurrency: false }, async () => {
  const databaseError = { code: "PGRST999", message: "Unexpected database failure" };
  await withSupabaseFromMock(() => ({
    select: () => ({
      order: () => ({
        limit: () => ({
          maybeSingle: async () => ({ data: null, error: databaseError }),
        }),
      }),
    }),
  }), async () => {
    await assert.rejects(() => getLatestSoilPh(), (error) => error === databaseError);
  });
});

test("pH writes still propagate PGRST205 before migration", { concurrency: false }, async () => {
  const databaseError = { code: "PGRST205", message: "Could not find the table 'public.soil_ph_readings' in the schema cache" };
  await withSupabaseFromMock((table) => {
    assert.equal(table, "soil_ph_readings");
    return {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: databaseError }),
        }),
      }),
    };
  }, async () => {
    await assert.rejects(() => createSoilPhReading({ soil_ph: 6.4 }), (error) => error === databaseError);
  });
});
