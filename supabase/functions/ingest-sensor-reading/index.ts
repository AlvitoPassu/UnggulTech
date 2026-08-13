import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-device-key",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method harus POST" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const payload = await request.json();
    const { sensor_id, moisture, temperature, humidity } = payload;

    if (
      !Number.isInteger(sensor_id) ||
      typeof moisture !== "number" ||
      !Number.isFinite(moisture)
    ) {
      return Response.json(
        { error: "sensor_id dan moisture harus valid" },
        { status: 400, headers: corsHeaders },
      );
    }

    const deviceKeys = JSON.parse(
      Deno.env.get("SENSOR_DEVICE_KEYS") || "{}",
    );

    const deviceKey = request.headers.get("x-device-key");

    if (!deviceKey || deviceKey !== deviceKeys[String(sensor_id)]) {
      return Response.json(
        { error: "Perangkat tidak diizinkan" },
        { status: 401, headers: corsHeaders },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SERVICE_ROLE_KEY") || "",
    );

    const { error } = await supabase
      .from("sensor_readings")
      .insert({
        sensor_id,
        moisture,
        temperature: typeof temperature === "number" ? temperature : null,
        humidity: typeof humidity === "number" ? humidity : null,
      });

    if (error) {
      console.error(error);

      return Response.json(
        { error: "Gagal menyimpan pembacaan sensor" },
        { status: 500, headers: corsHeaders },
      );
    }

    return Response.json(
      { success: true },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Payload JSON tidak valid" },
      { status: 400, headers: corsHeaders },
    );
  }
});