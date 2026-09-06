import { GoogleGenAI } from "@google/genai";
import { getHistoricalStatistics } from "./historicalService.js";
import { getNurseryOverview } from "./sensorService.js";
import { getWeatherForecast } from "./weatherService.js";

const SYSTEM_INSTRUCTION = `Anda adalah Unggul AI Assistant untuk sistem Smart Soil Monitoring nursery bibit kelapa sawit.
Jawab selalu dalam Bahasa Indonesia, singkat, jelas, dan informatif. Gunakan HANYA konteks data yang diberikan untuk angka, status, atau waktu. Jangan mengarang data dan nyatakan secara eksplisit bila data tidak tersedia.
Bedakan fakta data aktual dan analisis/rekomendasi. Untuk rekomendasi penyiraman, gunakan frasa "Rekomendasi berdasarkan data" dan tekankan bahwa keputusan akhir mengikuti kebijakan operasional perusahaan. Jika data curah hujan tidak tersedia, jangan menyimpulkan kebutuhan penyiraman dari hujan. Curah hujan di bawah 10 mm hanya dapat menjadi indikasi untuk mempertimbangkan penyiraman, sedangkan curah hujan minimal 10 mm dapat menjadi indikasi penyiraman mungkin tidak diperlukan.
Pahami soil moisture, sensor, bedengan, nursery, bibit, penyiraman, dan curah hujan. Sebutkan timestamp bila relevan. Gunakan paragraf pendek atau bullet bila membantu.`;

const getWitaDate = (daysAgo = 0) => {
  const witaNow = new Date(Date.now() + (8 * 60 * 60 * 1000));
  witaNow.setUTCDate(witaNow.getUTCDate() - daysAgo);
  return witaNow.toISOString().slice(0, 10);
};

const getCurrentWeather = (forecast) => {
  if (!forecast?.length) return null;
  const now = Date.now();
  return forecast.reduce((closest, item) => (
    Math.abs(new Date(item.local_datetime || item.utc_datetime).getTime() - now)
      < Math.abs(new Date(closest.local_datetime || closest.utc_datetime).getTime() - now)
      ? item
      : closest
  ));
};

async function buildNurseryContext() {
  const today = getWitaDate();
  const yesterday = getWitaDate(1);
  const [overview, todayStatistics, yesterdayStatistics, weatherResult] = await Promise.all([
    getNurseryOverview(),
    getHistoricalStatistics({ startDate: today, endDate: today }),
    getHistoricalStatistics({ startDate: yesterday, endDate: yesterday }),
    getWeatherForecast().catch(() => null),
  ]);

  const weather = getCurrentWeather(weatherResult);
  return {
    generatedAt: new Date().toISOString(),
    summary: overview.summary,
    sensors: overview.sensors.map(({ id, sensor_name, bedengan, location, status, moisture, lastSeen, isOnline, category }) => ({
      id,
      sensor_name,
      bedengan,
      location,
      configuredStatus: status,
      moisture,
      lastSeen,
      isOnline,
      category,
    })),
    historicalMoisture: {
      today: { date: today, ...todayStatistics },
      yesterday: { date: yesterday, ...yesterdayStatistics },
    },
    weather: weather ? {
      timestamp: weather.local_datetime || weather.utc_datetime,
      description: weather.weather,
      temperature: weather.temperature,
      humidity: weather.humidity,
      windSpeed: weather.wind_speed,
    } : null,
    rainfall: {
      available: false,
      note: "Sistem saat ini tidak menyediakan data curah hujan dalam konteks chatbot.",
    },
  };
}

export async function generateChatbotReply(message) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Konfigurasi Gemini belum tersedia.");
    error.code = "GEMINI_NOT_CONFIGURED";
    throw error;
  }

  const context = await buildNurseryContext();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const request = ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: `Konteks data nursery aktual (JSON):\n${JSON.stringify(context)}\n\nPertanyaan pengguna:\n${message}`,
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Permintaan AI melebihi batas waktu.")), 25000));
  const response = await Promise.race([request, timeout]);
  const reply = response.text?.trim();

  if (!reply) {
    throw new Error("Gemini tidak mengembalikan jawaban.");
  }

  return { reply, contextGeneratedAt: context.generatedAt };
}
