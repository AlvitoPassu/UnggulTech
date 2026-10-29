// =============================================================
// telegramService.js
// Layanan Bot Telegram untuk Unggul Monitoring:
// 1. Kirim notifikasi peringatan otomatis (kelembaban kritis, offline)
// 2. Bot interaktif (polling getUpdates): membalas pertanyaan
//    seperti "kelembaban", "ph tanah", "status", dll secara realtime.
// =============================================================

import { getNurseryOverview } from "./sensorService.js";
import { getLatestSoilPh } from "./soilPhService.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Mendukung beberapa Chat ID dipisah koma untuk broadcast notifikasi otomatis
// Contoh: TELEGRAM_CHAT_ID=5571697075,-4123456789
const TELEGRAM_CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// Cooldown per sensor (key: sensorId, value: timestamp terakhir kirim notif)
// Diatur 1 menit agar operator langsung menerima notifikasi setiap siklus pembacaan sensor
const alertCooldowns = new Map();
const configuredCooldownMinutes = Number(process.env.TELEGRAM_ALERT_COOLDOWN_MINUTES || 1);
const COOLDOWN_MS = (Number.isFinite(configuredCooldownMinutes) && configuredCooldownMinutes > 0 ? configuredCooldownMinutes : 1) * 60 * 1000; // 1 menit

// State untuk bot polling listener
let isPolling = false;
let pollingAbortController = null;

/**
 * Cek apakah bot Telegram sudah dikonfigurasi di .env.
 */
export const isTelegramConfigured = () =>
  Boolean(
    TELEGRAM_BOT_TOKEN &&
    TELEGRAM_CHAT_IDS.length > 0 &&
    TELEGRAM_BOT_TOKEN !== "ISI_TOKEN_BOT_ANDA" &&
    !TELEGRAM_CHAT_IDS.includes("ISI_CHAT_ID_ANDA")
  );

/**
 * Format tanggal sekarang ke WITA (UTC+8).
 */
const formatWita = () =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone:  "Asia/Makassar",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

/**
 * Format timestamp sembarang ke format tanggal & jam WITA.
 */
const formatDateTimeWita = (date) => {
  if (!date) return "Belum pernah aktif";
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone:  "Asia/Makassar",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(date)) + " WITA"
  );
};

/**
 * Cek cooldown untuk sensor tertentu.
 * Mengembalikan true jika boleh kirim notif (belum cooldown).
 */
const checkAndSetCooldown = (key) => {
  const last = alertCooldowns.get(key);
  const now  = Date.now();

  if (last && now - last < COOLDOWN_MS) return false;

  alertCooldowns.set(key, now);
  return true;
};

/**
 * Kirim pesan ke SATU chat_id tertentu (digunakan untuk membalas pesan user).
 * @param {string|number} chatId
 * @param {string} message - Teks format HTML
 */
export async function sendMessageToChat(chatId, message) {
  if (!TELEGRAM_BOT_TOKEN) return false;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    chatId,
        text:       message,
        parse_mode: "HTML",
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error(`[Telegram] Gagal balas ke chat ${chatId}:`, data.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[Telegram] Error saat balas ke chat ${chatId}:`, error.message);
    return false;
  }
}

/**
 * Kirim pesan teks ke seluruh daftar TELEGRAM_CHAT_IDS (broadcast notifikasi).
 * @param {string} message - Teks pesan (mendukung HTML sederhana)
 * @returns {Promise<boolean>} true jika berhasil
 */
export async function sendTelegramMessage(message) {
  if (!isTelegramConfigured()) {
    console.warn("[Telegram] Bot belum dikonfigurasi. Lewati pengiriman notifikasi.");
    return false;
  }

  let allSuccess = true;
  for (const chatId of TELEGRAM_CHAT_IDS) {
    const success = await sendMessageToChat(chatId, message);
    if (!success) allSuccess = false;
  }

  return allSuccess;
}

// =============================================================
// FUNGSI ALERT SPESIFIK (NOTIFIKASI OTOMATIS)
// =============================================================

/**
 * Kirim notif peringatan sensor kering.
 */
export async function alertMoistureLow({ sensorId, sensorName, bedengan, moisture }) {
  const key = `low-${sensorId}`;
  if (!checkAndSetCooldown(key)) return false;

  const message =
    `🚨 <b>PERINGATAN - Unggul Monitoring</b>\n\n` +
    `📍 <b>${bedengan} - ${sensorName}</b>\n` +
    `⚠️ Status: <b>KERING</b>\n` +
    `💧 Kelembaban tanah: <b>${moisture}%</b>\n\n` +
    `🌱 Tindakan: Segera lakukan penyiraman!\n` +
    `🕐 ${formatWita()} WITA`;

  return sendTelegramMessage(message);
}

/**
 * Kirim notif peringatan sensor terlalu basah.
 */
export async function alertMoistureHigh({ sensorId, sensorName, bedengan, moisture }) {
  const key = `high-${sensorId}`;
  if (!checkAndSetCooldown(key)) return false;

  const message =
    `⚠️ <b>PERINGATAN - Unggul Monitoring</b>\n\n` +
    `📍 <b>${bedengan} - ${sensorName}</b>\n` +
    `🌊 Status: <b>TERLALU BASAH</b>\n` +
    `💧 Kelembaban tanah: <b>${moisture}%</b>\n\n` +
    `🌱 Tindakan: Kurangi penyiraman / cek drainase.\n` +
    `🕐 ${formatWita()} WITA`;

  return sendTelegramMessage(message);
}

/**
 * Kirim notif peringatan sensor offline.
 */
export async function alertSensorOffline({ sensorId, sensorName, bedengan, lastSeen }) {
  const key = `offline-${sensorId}`;
  if (!checkAndSetCooldown(key)) return false;

  const lastSeenText = formatDateTimeWita(lastSeen);

  const message =
    `🔴 <b>SENSOR OFFLINE - Unggul Monitoring</b>\n\n` +
    `📍 <b>${bedengan} - ${sensorName}</b>\n` +
    `❌ Sensor tidak mengirim data lebih dari 5 menit.\n` +
    `🕐 Terakhir aktif: ${lastSeenText}\n\n` +
    `🔧 Tindakan: Periksa koneksi WiFi dan daya ESP32.`;

  return sendTelegramMessage(message);
}

/**
 * Kirim pesan test untuk verifikasi konfigurasi.
 */
export async function sendTestMessage() {
  const message =
    `✅ <b>Test Notifikasi - Unggul Monitoring</b>\n\n` +
    `Bot Telegram berhasil terhubung!\n` +
    `Notifikasi peringatan tanah akan masuk ke chat ini.\n` +
    `🕐 ${formatWita()} WITA`;

  return sendTelegramMessage(message);
}

// =============================================================
// BOT INTERAKTIF (POLLING & BALAS PESAN)
// =============================================================

/**
 * Format laporan kelembaban per bedengan.
 */
async function buildMoistureReportMessage() {
  try {
    const overview = await getNurseryOverview();
    const sensors = overview?.sensors || [];
    const avgMoisture = overview?.summary?.averageMoisture;
    const attention = overview?.attention || [];
    const activeSensors = overview?.summary?.activeSensors || 0;
    const offlineSensors = overview?.summary?.offlineSensors || 0;

    if (sensors.length === 0) {
      return `💧 <b>Status Kelembaban Tanah - Unggul Monitoring</b>\n\nBelum ada data sensor kelembaban yang terdaftar di database.`;
    }

    let bedenganList = "";
    sensors.forEach((s) => {
      const bedenganLabel = s.bedengan ? `Bedengan ${s.bedengan}` : (s.sensor_name || `Sensor ${s.id}`);
      const moistureText = s.moisture !== null && Number.isFinite(s.moisture) ? `${s.moisture}%` : "-";
      const lastSeenText = formatDateTimeWita(s.lastSeen);

      if (s.sensorHealth !== "online") {
        bedenganList += `• <b>${bedenganLabel}</b>: <b>${moistureText}</b> ⚪ <i>(Offline)</i>\n`;
        bedenganList += `  └ <i>Terakhir aktif: ${lastSeenText}</i>\n`;
      } else if (s.condition === "dry") {
        bedenganList += `• <b>${bedenganLabel}</b>: <b>${moistureText}</b> 🚨 <i>(Kering - Perlu Siram)</i>\n`;
      } else if (s.condition === "wet") {
        bedenganList += `• <b>${bedenganLabel}</b>: <b>${moistureText}</b> 💧 <i>(Basah)</i>\n`;
      } else {
        bedenganList += `• <b>${bedenganLabel}</b>: <b>${moistureText}</b> ✅ <i>(Lembab Optimal)</i>\n`;
      }
    });

    const avgText = avgMoisture !== null && Number.isFinite(avgMoisture) ? `${Number(avgMoisture).toFixed(1)}%` : "-";
    const drySensors = sensors.filter((s) => s.sensorHealth === "online" && s.condition === "dry");

    let message =
      `💧 <b>STATUS KELEMBABAN TANAH</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌱 <b>Kondisi Tiap Bedengan:</b>\n` +
      bedenganList +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Rata-rata:</b> <b>${avgText}</b>\n` +
      `📡 <b>Sensor Online:</b> ${activeSensors} / ${sensors.length} aktif\n`;

    if (offlineSensors === sensors.length) {
      message += `⚠️ <b>Status:</b> Semua sensor saat ini sedang <b>OFFLINE</b>.\n`;
    } else if (drySensors.length > 0) {
      message += `🚨 <b>Perhatian:</b> Ada ${drySensors.length} bedengan KERING butuh disiram segera!\n`;
    } else {
      message += `✨ <b>Kondisi:</b> Kondisi bibitan baik dan lembab.\n`;
    }

    const lastUpdated = overview?.summary?.lastUpdated;
    if (lastUpdated) {
      message += `🕐 <i>Terakhir Data Masuk: ${formatDateTimeWita(lastUpdated)}</i>`;
    } else {
      message += `🕐 <i>${formatWita()} WITA</i>`;
    }

    return message;
  } catch (error) {
    console.error("[Telegram Bot] Gagal mengambil data kelembaban:", error);
    return `❌ Gagal mengambil data kelembaban: ${error.message}`;
  }
}

/**
 * Format laporan pH tanah.
 */
async function buildSoilPhReportMessage() {
  try {
    const phData = await getLatestSoilPh();
    const soilPh = phData?.soilPh;
    const isActive = phData?.isActive;
    const measuredAt = phData?.measuredAt;

    if (soilPh === null || soilPh === undefined) {
      return (
        `🧪 <b>STATUS pH TANAH (DMS)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ Belum ada data pembacaan sensor pH di database.\n` +
        `Pastikan ESP32 sensor pH (COM6) sudah menyala dan mengirim data.`
      );
    }

    let statusDesc = "Netral / Ideal";
    let icon = "🟢";
    if (soilPh < 5.5) {
      statusDesc = "Sangat Masam (Perlu kapur/dolomit)";
      icon = "🔴";
    } else if (soilPh < 6.0) {
      statusDesc = "Agak Masam";
      icon = "🟡";
    } else if (soilPh <= 7.0) {
      statusDesc = "Netral / Ideal untuk Pembibitan";
      icon = "🟢";
    } else if (soilPh <= 7.5) {
      statusDesc = "Agak Basa";
      icon = "🟡";
    } else {
      statusDesc = "Terlalu Basa";
      icon = "🔴";
    }

    const sensorStatusText = isActive ? "🟢 Aktif (Online)" : "🔴 Tidak Aktif (Offline)";
    const measuredAtText = formatDateTimeWita(measuredAt);

    return (
      `🧪 <b>STATUS pH TANAH (DMS)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌱 <b>Nilai pH:</b> <b>${Number(soilPh).toFixed(1)}</b>\n` +
      `📊 <b>Kategori:</b> ${icon} <b>${statusDesc}</b>\n` +
      `📡 <b>Sensor pH:</b> ${sensorStatusText}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 <i>Terakhir Diukur: ${measuredAtText}</i>`
    );
  } catch (error) {
    console.error("[Telegram Bot] Gagal mengambil data pH:", error);
    return `❌ Gagal mengambil data pH tanah: ${error.message}`;
  }
}

/**
 * Format laporan ringkasan lengkap (pH + Kelembaban).
 */
async function buildFullStatusMessage() {
  try {
    const overview = await getNurseryOverview();
    const phData = await getLatestSoilPh();

    const sensors = overview?.sensors || [];
    const avgMoisture = overview?.summary?.averageMoisture;
    const soilPh = phData?.soilPh;
    const isPhActive = phData?.isActive;

    const avgMoistureText = avgMoisture !== null && Number.isFinite(avgMoisture) ? `${Number(avgMoisture).toFixed(1)}%` : "-";
    const soilPhText = soilPh !== null && Number.isFinite(soilPh) ? Number(soilPh).toFixed(1) : "-";
    const phStatusBadge = isPhActive ? "🟢 Online" : "🔴 Offline";

    let bedenganSummary = "";
    sensors.forEach((s) => {
      const label = s.bedengan ? `Bdg ${s.bedengan}` : (s.sensor_name || `S${s.id}`);
      const val = s.moisture !== null && Number.isFinite(s.moisture) ? `${s.moisture}%` : "-";

      if (s.sensorHealth !== "online") {
        const lastSeenShort = s.lastSeen
          ? new Intl.DateTimeFormat("id-ID", {
              timeZone: "Asia/Makassar",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(s.lastSeen))
          : "no data";
        bedenganSummary += `• ${label}: <b>${val}</b> ⚪ <i>(Offline: ${lastSeenShort})</i>\n`;
      } else {
        const icon = s.condition === "dry" ? "🚨" : "💧";
        bedenganSummary += `• ${label}: <b>${val}</b> ${icon}\n`;
      }
    });

    return (
      `📊 <b>RINGKASAN KONDISI UNGGUL MONITORING</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧪 <b>pH Tanah:</b> <b>${soilPhText}</b> (${phStatusBadge})\n` +
      `💧 <b>Rata-rata Kelembaban:</b> <b>${avgMoistureText}</b>\n` +
      `📡 <b>Sensor Aktif:</b> ${overview?.summary?.activeSensors || 0} / ${sensors.length}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌱 <b>Status Bedengan:</b>\n` +
      bedenganSummary +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 <i>${formatWita()} WITA</i>`
    );
  } catch (error) {
    console.error("[Telegram Bot] Gagal membuat ringkasan:", error);
    return `❌ Gagal mengambil ringkasan status: ${error.message}`;
  }
}

/**
 * Tangani pesan teks masuk dari user Telegram.
 * Mendukung huruf besar/kecil (case-insensitive) dan variasi kata.
 */
async function handleIncomingMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  // Bersihkan spasi ganda dan ubah ke huruf kecil semua
  const text = (msg.text || "").trim().toLowerCase().replace(/\s+/g, " ");
  console.log(`[Telegram Bot] Pesan diterima dari chat ${chatId}: "${msg.text}"`);

  // 1. Menu bantuan / start (Contoh: "bantuan", "BANTUAN", "/start", "menu", "halo", "hai")
  const isHelp =
    text === "/start" ||
    text === "/help" ||
    text === "bantuan" ||
    text === "menu" ||
    text === "halo" ||
    text === "hai" ||
    text === "hi" ||
    text === "panduan";

  if (isHelp) {
    const helpMsg =
      `🌿 <b>Halo! Selamat datang di Bot Unggul Monitoring</b>\n\n` +
      `Anda dapat memantau kondisi bibit dan tanah pembibitan secara langsung melalui bot ini.\n\n` +
      `<b>Ketik salah satu kata kunci di bawah (bebas huruf besar/kecil):</b>\n` +
      `💧 Ketik <b>kelembaban</b> atau <b>kelembaban tanah</b> — Cek kelembaban semua bedengan\n` +
      `🧪 Ketik <b>ph tanah</b> atau <b>ph</b> — Cek nilai & status pH tanah terkini\n` +
      `📊 Ketik <b>status</b> atau <b>cek</b> — Ringkasan lengkap pH & seluruh bedengan\n` +
      `❓ Ketik <b>bantuan</b> — Menampilkan panduan ini\n\n` +
      `🕐 <i>${formatWita()} WITA</i>`;

    return sendMessageToChat(chatId, helpMsg);
  }

  // 2. Tanya status keseluruhan (Contoh: "status", "STATUS", "kondisi", "cek", "ringkasan", "/status")
  const isFullStatus =
    text.includes("status") ||
    text.includes("kondisi") ||
    text.includes("ringkasan") ||
    text.includes("overview") ||
    text === "cek" ||
    text === "semua" ||
    text === "/status";

  if (isFullStatus) {
    const reply = await buildFullStatusMessage();
    return sendMessageToChat(chatId, reply);
  }

  // 3. Tanya kelembaban (Contoh: "kelembaban", "KELEMBABAN", "kelembaban tanah", "KELEMBABAN TANAH", "kelembapan", "lembab", "moisture")
  const isMoisture =
    text.includes("kelembaban") ||
    text.includes("kelembapan") ||
    text.includes("lembab") ||
    text.includes("moisture") ||
    text === "/kelembaban";

  if (isMoisture) {
    const reply = await buildMoistureReportMessage();
    return sendMessageToChat(chatId, reply);
  }

  // 4. Tanya pH tanah (Contoh: "ph tanah", "PH TANAH", "ph", "PH", "keasaman", "/ph")
  const isPh =
    text.includes("ph tanah") ||
    text.includes("keasaman") ||
    /\bph\b/i.test(text) ||
    text === "/ph";

  if (isPh) {
    const reply = await buildSoilPhReportMessage();
    return sendMessageToChat(chatId, reply);
  }

  // 5. Pesan tidak dikenali
  const fallbackMsg =
    `🤔 Maaf, saya belum mengenali perintah <i>"${msg.text}"</i>.\n\n` +
    `Coba ketik salah satu di bawah ini (bebas huruf besar atau kecil):\n` +
    `• 💧 <b>kelembaban</b> / <b>kelembaban tanah</b>\n` +
    `• 🧪 <b>ph</b> / <b>ph tanah</b>\n` +
    `• 📊 <b>status</b> / <b>cek</b>\n` +
    `• ❓ <b>bantuan</b>`;

  return sendMessageToChat(chatId, fallbackMsg);
}

/**
 * Jalankan polling Telegram di background untuk mendengarkan pesan masuk.
 */
export function startTelegramBotPolling() {
  if (isPolling) return;

  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "ISI_TOKEN_BOT_ANDA") {
    console.log("[Telegram Bot] Bot Token belum diatur di .env. Polling dinonaktifkan.");
    return;
  }

  isPolling = true;
  pollingAbortController = new AbortController();
  console.log("[Telegram Bot] 🤖 Bot Telegram interaktif aktif dan mendengarkan pesan...");

  let offset = 0;

  // Jalankan long polling secara asynchronous di background
  (async () => {
    while (isPolling) {
      try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=20`;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          // Jika terjadi error dari Telegram (misal 409 conflict), tunggu sebentar
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        const data = await response.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            if (update.message && update.message.text) {
              handleIncomingMessage(update.message).catch((err) =>
                console.error("[Telegram Bot] Error handler pesan:", err.message)
              );
            }
          }
        }
      } catch (err) {
        if (!isPolling) break;
        // Jika timeout atau disconnect jaringan biasa, istirahat 3 detik lalu poll lagi
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  })();
}

/**
 * Hentikan polling bot Telegram jika backend dimatikan.
 */
export function stopTelegramBotPolling() {
  isPolling = false;
  if (pollingAbortController) {
    try {
      pollingAbortController.abort();
    } catch {}
  }
}
