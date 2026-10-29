import { getHistoricalStatistics, getHistoricalTrend } from "./historicalService.js";
import { getNurseryOverview } from "./sensorService.js";
import { getWeatherForecast } from "./weatherService.js";
import { getLatestRainfall } from "./rainfallService.js";
import { getLatestSoilPh } from "./soilPhService.js";
import { validateChatbotTopic } from "./domainGuard.js";
import { getRecommendationDecision } from "../domain/recommendationDecisionEngine.js";
import { inferPlantPhase, retrieveKnowledge } from "./knowledgeBaseService.js";
import { analysisToText, generateAgronomyAnalysis, withAiTimeout } from "./agronomyAnalysisService.js";

export const normalizeChatbotReply = (text) => text
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => {
    let formattedLine = line.trimEnd();

    if (/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/.test(formattedLine)) return "";
    formattedLine = formattedLine.replace(/^\s*#{1,6}\s*/, "");
    formattedLine = formattedLine.replace(/^\s*[*+-]\s+\*\*(.+?)\*\*\s*$/, "$1");
    formattedLine = formattedLine.replace(/^\s*[*+-]\s+/, "• ");
    formattedLine = formattedLine.replace(/```(?:[a-zA-Z0-9_-]+)?/g, "");
    formattedLine = formattedLine.replace(/`([^`\n]+)`/g, "$1");
    formattedLine = formattedLine.replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1");
    formattedLine = formattedLine.replace(/\*\*([^*\n]+)\*\*/g, "$1");
    formattedLine = formattedLine.replace(/__([^_\n]+)__/g, "$1");
    formattedLine = formattedLine.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
    formattedLine = formattedLine.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
    return formattedLine;
  })
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

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

const getQuestionNeeds = (message) => {
  const question = message.toLowerCase();

  return {
    history: /7\s*hari|seminggu|historis|riwayat|tren|menurun|meningkat|perubahan/.test(question),
    operational: /kondisi\s+(?:saat\s+ini|sekarang)|tindakan|rekomendasi|perlu\s+disiram|penyiraman|disiram/.test(question),
  };
};

const getHistoricalContext = async (needsHistory) => {
  if (!needsHistory) return undefined;

  const startDate = getWitaDate(6);
  const endDate = getWitaDate();
  const [statistics, trend] = await Promise.all([
    getHistoricalStatistics({ startDate, endDate }),
    getHistoricalTrend({ startDate, endDate, interval: "day" }),
  ]);

  return { startDate, endDate, statistics, trend };
};

const toRainfallInput = (rainfallResult) => ({
  value: rainfallResult?.reading?.rainfall_value,
  unit: rainfallResult?.reading?.unit ?? "mm",
  freshness: rainfallResult?.freshness ?? "missing",
  measuredAt: rainfallResult?.reading?.measured_at ?? null,
});

export async function getGlobalOperationalDecisions(sensors = [], rainfallLookup = getLatestRainfall) {
  const rainfall = toRainfallInput(await rainfallLookup().catch(() => null));

  return sensors.map((sensor) => ({
    rainfall,
    decision: getRecommendationDecision({
      moisture: sensor.moisture,
      sensorHealth: sensor.sensorHealth,
      rainfall,
    }).decision,
  }));
}

async function buildNurseryContext(message) {
  const needs = getQuestionNeeds(message);
  const safeRead = (request) => withAiTimeout(Promise.resolve().then(request), 3000).catch(() => null);
  const [overview, historical, weatherResult, soilPh, rainfallResult] = await Promise.all([
    safeRead(() => getNurseryOverview()),
    safeRead(() => getHistoricalContext(needs.history)),
    safeRead(() => getWeatherForecast()),
    safeRead(() => getLatestSoilPh()),
    safeRead(() => getLatestRainfall()),
  ]);
  const operationalDecisions = overview && needs.operational
    ? await getGlobalOperationalDecisions(overview.sensors, async () => rainfallResult)
    : null;

  const context = { generatedAt: new Date().toISOString(), plantPhase: inferPlantPhase(message), plantAge: null, phaseSource: "question_only_not_verified", monitoringAvailable: Boolean(overview) };
  context.globalSoilPh = soilPh;
  if (overview) {
    context.summary = overview.summary;
    context.sensors = overview.sensors.map(({ id, sensor_name, bedengan, location, status, moisture, lastSeen, isOnline, condition, needsAttention, sensorHealth }, index) => ({
      id,
      sensor_name,
      bedengan,
      location,
      configuredStatus: status,
      moisture,
      lastSeen,
      isOnline,
      condition,
      needsAttention,
      sensorHealth,
      rainfall: operationalDecisions?.[index]?.rainfall ?? null,
      sopComparison: operationalDecisions?.[index]?.decision ?? null,
    }));
  }

  if (historical) context.historicalMoisture = historical;

  const weather = getCurrentWeather(weatherResult);
  context.weather = weather ? {
    type: "forecast",
    timestamp: weather.utc_datetime || weather.local_datetime,
    description: weather.weather,
    temperature: weather.temperature,
    humidity: weather.humidity,
    windSpeed: weather.wind_speed,
  } : null;

  if (rainfallResult?.reading) {
    context.rainfall = {
      available: rainfallResult.available,
      freshness: rainfallResult.freshness,
      isFresh: rainfallResult.isFresh,
      type: "recorded_measurement",
      source: "rainfall_readings",
      rainfall_value: rainfallResult.reading.rainfall_value,
      unit: rainfallResult.reading.unit,
      measured_at: rainfallResult.reading.measured_at,
      notes: rainfallResult.reading.notes
    };
  } else {
    context.rainfall = {
      available: false,
      freshness: rainfallResult?.freshness || "missing",
      isFresh: false,
      note: "Data pengukuran curah hujan aktual tidak tersedia atau belum tercatat."
    };
  }

  return context;
}

export async function generateChatbotReply(message) {
  const topic = validateChatbotTopic(message);
  if (!topic.allowed) {
    return { success: true, message: topic.message, reply: topic.message };
  }

  if (/^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|terima kasih|thanks|siapa (kamu|anda)|apa kabar)[!.?\s]*$/i.test(message)) {
    const reply = "Halo! Saya Unggul AI Assistant. Saya membantu pertanyaan pembibitan kelapa sawit serta analisis data nursery. Ceritakan gejala atau kondisi bibit, fase, dan umurnya.";
    return { success: true, message: reply, reply };
  }

  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Konfigurasi Gemini belum tersedia.");
    error.code = "GEMINI_NOT_CONFIGURED";
    throw error;
  }

  const [context, knowledge] = await Promise.all([
    buildNurseryContext(message),
    retrieveKnowledge({ query: message }),
  ]);
  context.knowledge = knowledge;
  const analysis = await generateAgronomyAnalysis(context, { message });
  const reply = analysisToText(analysis);
  return {
    success: true, message: reply, reply, analysis,
    knowledge: { status: knowledge.status, method: knowledge.method, count: knowledge.chunks.length },
    contextGeneratedAt: context.generatedAt,
  };
}
