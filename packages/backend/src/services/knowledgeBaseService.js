import { readFile } from "node:fs/promises";
import { supabase } from "../config/supabase.js";

export const PLANT_PHASES = ["pre_nursery", "main_nursery", "tbm", "tm", "general"];
export const KNOWLEDGE_CATEGORIES = ["fertilization", "soil", "soil_moisture", "ph", "watering", "rainfall", "weather", "nutrient_deficiency", "pest", "disease", "weed", "growth", "nursery_management", "root_health", "leaf_symptoms", "maintenance"];
const catalogUrl = new URL("../knowledge/research.json", import.meta.url);
const categoryPatterns = {
  fertilization: /pupuk|pemupukan|fertili|nutrisi|hara|npk/,
  soil_moisture: /kelembap|kelembab|moisture|kering|basah|lembap/,
  watering: /siram|nyiram|irigasi|watering|kebutuhan air/,
  ph: /\bph\b|asam|kapur/,
  rainfall: /hujan|rainfall/,
  weather: /cuaca|weather|suhu/,
  leaf_symptoms: /daun|kuning|nguning|klorosis|leaf/,
  nutrient_deficiency: /defisiensi|kekurangan.*hara|kuning|nguning/,
  root_health: /akar|root/,
  disease: /penyakit|jamur|bercak/,
  pest: /hama|ulat|serangga/,
  weed: /gulma|rumput/,
  growth: /tumbuh|kerdil/,
};
const stopWords = new Set("apa apakah bagaimana mengapa kenapa saya anda yang dan atau untuk pada dari dengan dalam bibit kelapa sawit nursery kondisi data saat ini berikan tolong analisis rekomendasi sistem tanah".split(" "));
export const queryTerms = (query = "") => [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])]
  .filter((term) => term.length > 2 && !stopWords.has(term)).slice(0, 30);

export function inferPlantPhase(message = "") {
  if (/pre[-_ ]?nursery/i.test(message)) return "pre_nursery";
  if (/main[-_ ]?nursery/i.test(message)) return "main_nursery";
  if (/\btbm\b/i.test(message)) return "tbm";
  if (/\btm\b/i.test(message)) return "tm";
  return "general";
}

export const inferCategories = (query = "") => Object.entries(categoryPatterns)
  .filter(([, pattern]) => pattern.test(query.toLowerCase())).map(([category]) => category);

export const safeSourceUrl = (value) => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};

export const validKnowledgeEntry = (entry) => entry && typeof entry.id === "string"
  && typeof entry.title === "string" && entry.title.trim() && typeof entry.content === "string" && entry.content.trim()
  && PLANT_PHASES.includes(entry.plant_phase) && KNOWLEDGE_CATEGORIES.includes(entry.category)
  && ["journal", "technical_guideline", "research", "sop"].includes(entry.source_type)
  && (safeSourceUrl(entry.url) || (typeof entry.doi === "string" && /^10\.\d{4,9}\/\S+$/.test(entry.doi)));

export function rankKnowledge(entries, { query = "", plantPhase = "general", categories = inferCategories(query), limit = 5 } = {}) {
  const terms = queryTerms(query);
  const phase = PLANT_PHASES.includes(plantPhase) ? plantPhase : "general";
  const allowedPhases = phase === "general" ? ["general", "pre_nursery", "main_nursery"] : ["general", phase];
  return entries.filter(validKnowledgeEntry).filter((entry) => allowedPhases.includes(entry.plant_phase))
    .map((entry) => {
      const searchable = `${entry.title} ${entry.content} ${entry.category} ${entry.sub_category || ""}`.toLowerCase();
      const categoryScore = categories.filter((category) => [entry.category, entry.sub_category].includes(category)).length * 4;
      const relevance = categoryScore + terms.filter((term) => searchable.includes(term)).length;
      return { entry, score: relevance > 0 ? relevance + (phase !== "general" && entry.plant_phase === phase ? 2 : 0) : 0 };
    }).filter(({ score }) => score > 0)
    .sort((a, b) => (a.entry.source_type === "sop") - (b.entry.source_type === "sop") || b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.min(5, Math.max(1, Number(limit) || 5)))
    .map(({ entry }) => ({ ...entry, content: entry.content.slice(0, 2200), context: String(entry.context || "").slice(0, 1000), embedding: undefined }));
}

// No embeddings or vector dependency exists. Lexical retrieval is intentional;
// semantic retrieval must wait for a reviewed provider/index configuration.
export async function retrieveKnowledge({ query = "", plantPhase = inferPlantPhase(query), categories = inferCategories(query) } = {}, { load, timeoutMs = 1500, source = process.env.AI_KB_SOURCE || "local" } = {}) {
  let timer;
  const controller = new AbortController();
  try {
    const read = async () => {
      if (load) return load();
      if (source === "local") return JSON.parse(await readFile(catalogUrl, "utf8"));
      if (source !== "database") throw new Error("Unsupported Knowledge Base source");
      const terms = queryTerms(query).filter((term) => /^[\p{L}\p{N}_]+$/u.test(term));
      // Query-time expansion bridges Indonesian question terms to category names.
      const search = [...terms, ...categories].join(" | ");
      if (!search) return [];
      const phases = plantPhase === "general" ? ["general", "pre_nursery", "main_nursery"] : ["general", plantPhase];
      const { data, error } = await supabase.from("ai_knowledge_chunks").select("id,title,content,category,sub_category,plant_phase,author,institution,year,source_type,country,doi,url,context,created_at,updated_at")
        .in("plant_phase", phases).textSearch("search_vector", search, { config: "simple" }).limit(40).abortSignal(controller.signal);
      if (error) throw error;
      return data || [];
    };
    const entries = await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Knowledge Base timeout")); }, timeoutMs);
    })]);
    if (!Array.isArray(entries)) throw new Error("Invalid Knowledge Base catalog");
    const chunks = rankKnowledge(entries, { query, plantPhase, categories });
    return { status: chunks.some((entry) => entry.source_type !== "sop") ? "available" : "empty", method: "lexical", source, plantPhase, chunks };
  } catch {
    return { status: "unavailable", method: "lexical", source, plantPhase, chunks: [] };
  } finally { clearTimeout(timer); }
}
