const DOMAIN_REJECTION = "Maaf, saya adalah Unggul AI Assistant yang berfokus pada agriculture, khususnya kelapa sawit dan monitoring nursery. Saya hanya dapat membantu pertanyaan yang berkaitan dengan topik tersebut.";

const GREETING_PATTERN = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam))(?:[\s,]+.*)?[!.?]*$/i;
const BASIC_CONVERSATION_PATTERN = /^(apa\s+kabar|siapa\s+(kamu|anda)|kamu\s+siapa|siapa\s+nama\s+(kamu|anda)|apa\s+yang\s+bisa\s+(kamu|anda)\s+lakukan|terima\s+kasih|thanks|nama\s+saya\s+[a-z][a-z\s'-]*|saya\s+(ingin|mau)\s+bertanya|bisa\s+bantu\s+saya|tolong\s+bantu\s+saya)[!.?]*$/i;
const PROMPT_INJECTION_PATTERN = /(abaikan|lupakan|lewati|hapus).*(instruksi|aturan|system|sistem)|mulai sekarang.*(programmer|chatbot umum|bebas)|ignore\s+(all|previous|prior)\s+instructions|forget\s+(all|previous|prior)\s+instructions/i;
const AGRICULTURE_TERMS = /\b(agriculture|agricultural|pertanian|tani|kelapa\s+sawit|sawit|nursery|pre[- ]?nursery|main[- ]?nursery|pembibitan|bibit|tanaman|budidaya|kebun|perkebunan|pemupukan|pupuk|pupuk\s+apa|nutrisi|unsur\s+hara|npk|nitrogen|fosfor|kalium|mikro(?:nutrien)?|makro(?:nutrien)?|dosis\s+pupuk|waktu\s+pemupukan|kesuburan|hama|penyakit\s+tanaman|daun|afkir|seleksi\s+bibit|pertumbuhan)\b/i;
const MONITORING_TERMS = /\b(soil\s+moisture|moisture|kelembapan(?:\s+tanah)?|kondisi\s+tanah|pH(?:\s+tanah)?|suhu|sensor(?:\s+(?:pertanian|tanah|kelembapan|moisture))?|IoT(?:\s+(?:pertanian|tanaman))?|data\s+(?:monitoring|sensor|historis)|monitoring\s+(?:tanaman|nursery)|bedengan|penyiraman|disiram|kebutuhan\s+air|curah\s+hujan|cuaca)\b/i;
const SENSOR_QUERY_PATTERN = /\bsensor\b/i;
const SENSOR_INTENT_PATTERN = /\b(kering|offline|status|terbaru|mana|kondisi|moisture|kelembapan|aktif)\b/i;
const PLANT_CONTEXT_TERMS = /\b(tanah|media\s+tanam|air|hujan|cuaca|kering|lembap|kelembaban|siram|daun|akar|tanam|tanaman|bibit)\b/i;
const OBVIOUS_NON_DOMAIN_PATTERN = /\b(presiden|politik|agama|film|serial|olahraga|sepak\s+bola|cryptocurrency|crypto|bitcoin|resep\s+(?:makanan|masakan)|nasi\s+goreng|kode\s+(?:python|javascript|java)|membuat\s+(?:website|aplikasi|game))\b/i;

export const DOMAIN_REJECTION_MESSAGE = DOMAIN_REJECTION;

export function isAgricultureRelated(message) {
  const question = String(message ?? "").trim();
  if (!question || PROMPT_INJECTION_PATTERN.test(question)) return false;
  if (GREETING_PATTERN.test(question) || BASIC_CONVERSATION_PATTERN.test(question)) return true;
  if (AGRICULTURE_TERMS.test(question) || MONITORING_TERMS.test(question)) return true;
  if (SENSOR_QUERY_PATTERN.test(question) && SENSOR_INTENT_PATTERN.test(question)) return true;
  if (OBVIOUS_NON_DOMAIN_PATTERN.test(question)) return false;

  // Generic plant, soil, water, and weather questions remain in-domain.
  return PLANT_CONTEXT_TERMS.test(question) && /\b(apakah|bagaimana|berapa|cara|perlu|cukup|menjaga|mengatasi|penyebab|kondisi|terlalu|untuk)\b/i.test(question);
}

export function validateChatbotTopic(message) {
  return isAgricultureRelated(message)
    ? { allowed: true }
    : { allowed: false, message: DOMAIN_REJECTION };
}