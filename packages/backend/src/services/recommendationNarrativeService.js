import { GoogleGenAI } from "@google/genai";

const recommendationInstruction = `Anda menyusun rekomendasi umum untuk petugas nursery bibit kelapa sawit.
Gunakan HANYA data pada JSON konteks. Jangan mengarang angka, status, dosis, volume air, interval, standar agronomi, atau kondisi yang tidak ada pada konteks.
Keputusan operasional pada field decision sudah ditetapkan oleh aturan sistem dan tidak boleh diubah. Jika data sensor atau curah hujan tidak tersedia/terbaru, utamakan pemeriksaan atau pelengkapan data sebelum tindakan lapangan.

Berikan 3 sampai 5 rekomendasi yang paling relevan dalam Bahasa Indonesia sederhana dan profesional. Setiap rekomendasi harus berupa satu string: baris pertama adalah judul tindakan yang jelas, lalu satu baris kosong, diikuti uraian 2 sampai 4 kalimat. Uraian wajib menjelaskan kondisi yang menjadi dasar, tindakan yang perlu dilakukan, alasan tindakan, dan hal yang harus dipantau sesudahnya. Jangan membuat rekomendasi satu kalimat, jangan mengulang isi antaritem, dan jangan menggunakan Markdown.

Keluarkan JSON valid saja dengan bentuk tepat: {"recommendations":["Judul\\n\\nUraian", "..."]}.`;

const conditionLabel = {
  dry: "kering",
  normal: "normal",
  wet: "basah",
};

const formatNumber = (value, fractionDigits = 1) => Number(value).toLocaleString("id-ID", {
  maximumFractionDigits: fractionDigits,
  minimumFractionDigits: fractionDigits,
});

const moistureDetail = (moisture = {}) => {
  if (!Number.isFinite(moisture.value) || !conditionLabel[moisture.condition]) {
    return "Data kelembaban tanah belum tersedia atau belum valid";
  }

  return `Kelembaban tanah terbaca ${formatNumber(moisture.value)}% dan berada pada kondisi ${conditionLabel[moisture.condition]}`;
};

const rainfallDetail = (rainfall = {}) => {
  if (rainfall.freshness === "fresh" && Number.isFinite(rainfall.value) && rainfall.unit === "mm") {
    return `Curah hujan aktual hari ini tercatat ${formatNumber(rainfall.value)} mm`;
  }
  if (rainfall.freshness === "stale") return "Data curah hujan terakhir bukan pengukuran hari ini";
  return "Data curah hujan aktual belum tersedia atau belum valid";
};

const recommendation = (title, description) => `${title}\n\n${description}`;

const pHRecommendation = (soilPh) => {
  if (!Number.isFinite(soilPh?.soilPh)) return null;

  const freshness = soilPh.isActive ? "masih aktif" : "merupakan pembacaan terakhir yang belum aktif";
  return recommendation(
    "Tinjau pembacaan pH tanah sebagai data pendukung",
    `Pembacaan pH tanah global ${formatNumber(soilPh.soilPh, 2)} ${freshness}. Bandingkan pembacaan berikutnya dengan nilai ini sebelum mengubah perlakuan pada media tanam. Pemantauan tersebut membantu memastikan perubahan kondisi media tidak dinilai hanya dari satu pembacaan.`
  );
};

const weatherRecommendation = (weather) => {
  if (!weather?.description) return null;

  return recommendation(
    "Sesuaikan pemeriksaan lapangan dengan prakiraan cuaca",
    `Prakiraan cuaca yang tersedia menunjukkan ${weather.description}. Gunakan informasi ini sebagai pertimbangan saat memeriksa media dan bibit, tetapi tetap utamakan pembacaan curah hujan aktual untuk keputusan operasional. Setelah pemeriksaan, pantau apakah perubahan cuaca diikuti perubahan kelembaban pada sensor.`
  );
};

export const buildFallbackGeneralRecommendations = ({ decision = {}, moisture = {}, sensorHealth, rainfall = {}, soilPh, weather } = {}) => {
  const moistureText = moistureDetail(moisture);
  const rainfallText = rainfallDetail(rainfall);
  let recommendations;

  if (decision.code === "water") {
    recommendations = [
      recommendation(
        "Lakukan penyiraman sesuai keputusan operasional",
        `${moistureText}, sedangkan ${rainfallText.toLowerCase()}. Lakukan penyiraman mengikuti durasi dan jadwal yang ditampilkan pada keputusan operasional, tanpa menambah perlakuan di luar data tersebut. Setelah penyiraman, pantau pembacaan kelembaban berikutnya dan periksa media bila nilainya tidak berubah seperti yang diharapkan.`
      ),
      recommendation(
        "Periksa kondisi media tanam setelah penyiraman",
        "Periksa langsung apakah media menerima air secara merata dan tidak ada genangan. Pemeriksaan ini diperlukan agar tindakan penyiraman tidak membuat media terlalu basah pada bagian tertentu. Perhatikan kondisi fisik bibit dan media pada pemeriksaan berikutnya sebelum menentukan tindakan lanjutan."
      ),
      recommendation(
        "Bandingkan data sensor pada pembacaan berikutnya",
        "Gunakan pembacaan kelembaban berikutnya untuk menilai perubahan kondisi setelah penyiraman. Bandingkan dengan kondisi saat ini dan catat bila terjadi perubahan yang tidak wajar. Data tersebut membantu menentukan apakah media perlu diperiksa langsung kembali."
      ),
    ];
  } else if (decision.code === "no_watering") {
    recommendations = [
      recommendation(
        "Pertahankan kondisi media tanam saat ini",
        `${moistureText} dan ${rainfallText.toLowerCase()}. Keputusan operasional saat ini tidak memerlukan penyiraman tambahan, sehingga perubahan perlakuan yang berlebihan sebaiknya dihindari. Pantau pembacaan kelembaban berikutnya untuk memastikan media tetap tidak menjadi terlalu kering atau terlalu basah.`
      ),
      recommendation(
        "Lanjutkan pemeriksaan kondisi bibit dan media",
        "Amati kondisi fisik bibit dan permukaan media saat pemeriksaan rutin. Pemeriksaan lapangan membantu memastikan data sensor sejalan dengan kondisi nyata di bedengan. Jika terlihat perubahan yang berbeda dari pembacaan sensor, lakukan pengecekan sensor sebelum mengambil tindakan berikutnya."
      ),
      recommendation(
        "Evaluasi perubahan data sebelum tindakan berikutnya",
        "Bandingkan kelembaban dan curah hujan pada pembacaan terbaru dengan data saat ini. Perbandingan ini membantu mengenali kecenderungan media sebelum memutuskan penyiraman atau pemeliharaan lain. Perhatikan terutama perubahan yang terjadi setelah hujan atau perubahan cuaca."
      ),
    ];
  } else if (decision.code === "inspect_bed") {
    recommendations = [
      recommendation(
        "Periksa kondisi bedengan sebelum melakukan tindakan",
        `${moistureText} dan ${rainfallText.toLowerCase()}. Keputusan operasional meminta pemeriksaan bedengan terlebih dahulu agar tindakan tidak hanya didasarkan pada satu pembacaan. Periksa kondisi fisik media, adanya genangan atau bagian yang terlalu kering, lalu pantau nilai sensor setelah pemeriksaan.`
      ),
      recommendation(
        "Tunda perubahan perlakuan sampai kondisi lapangan terverifikasi",
        "Hindari menambah air atau mengubah perlakuan media sebelum hasil pemeriksaan lapangan sesuai dengan data sensor. Langkah ini mengurangi risiko tindakan yang tidak sesuai dengan kondisi media sebenarnya. Setelah verifikasi, bandingkan kembali pembacaan sensor untuk menentukan tindakan berikutnya."
      ),
      recommendation(
        "Pantau kecenderungan kelembaban dan curah hujan",
        "Bandingkan data kelembaban serta curah hujan berikutnya dengan data saat ini untuk melihat arah perubahan kondisi media. Gunakan catatan tersebut bersama hasil pemeriksaan bedengan, bukan sebagai satu-satunya dasar tindakan. Lakukan pemeriksaan ulang bila perubahan data tidak sesuai dengan kondisi fisik di lapangan."
      ),
    ];
  } else {
    const unavailableReason = sensorHealth !== "online"
      ? "Status sensor belum online atau pembacaannya belum terbarui"
      : rainfallText;
    recommendations = [
      recommendation(
        "Pastikan data utama tersedia sebelum menentukan tindakan",
        `${unavailableReason}. Karena data ini diperlukan untuk keputusan operasional, hindari menetapkan penyiraman atau perubahan perlakuan hanya berdasarkan perkiraan. Periksa sumber data yang belum tersedia, lalu pantau kembali pembaruan pembacaan sebelum mengambil tindakan.`
      ),
      recommendation(
        "Lakukan pemeriksaan lapangan pada media dan bibit",
        "Periksa kondisi fisik media dan bibit sebagai langkah sementara selama keputusan otomatis belum dapat dibuat. Catat bila terdapat media yang terlalu kering, terlalu basah, atau kondisi bibit yang perlu perhatian. Cocokkan kembali temuan tersebut dengan data sensor setelah data tersedia atau terbarui."
      ),
      recommendation(
        "Tinjau ulang pembacaan sensor dan curah hujan",
        "Pastikan pembacaan sensor terbaru dapat diterima sistem dan data curah hujan tercatat dengan satuan yang benar. Data yang lengkap membantu sistem menghasilkan keputusan yang sesuai dengan kondisi saat ini. Setelah data diperbarui, bandingkan hasilnya dengan pemeriksaan lapangan sebelumnya."
      ),
    ];
  }

  const optionalRecommendation = pHRecommendation(soilPh) || weatherRecommendation(weather);
  return optionalRecommendation ? [...recommendations, optionalRecommendation] : recommendations;
};

const normalizeRecommendations = (input) => {
  if (!Array.isArray(input) || input.length < 3 || input.length > 5) return null;

  const normalized = input.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item.title === "string" && typeof item.description === "string") {
      return `${item.title}\n\n${item.description}`;
    }
    return "";
  }).map((item) => item.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim());

  return normalized.every((item) => {
    const [title, ...description] = item.split("\n").filter(Boolean);
    return title?.length >= 8 && description.join(" ").length >= 120;
  }) ? normalized : null;
};

export const parseGeneralRecommendationResponse = (text) => {
  if (typeof text !== "string" || !text.trim()) return null;

  try {
    const data = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
    return normalizeRecommendations(data?.recommendations);
  } catch {
    return null;
  }
};

export async function generateGeneralRecommendations(context) {
  const fallback = buildFallbackGeneralRecommendations(context);
  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const request = ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: `Konteks Recommendation AI (JSON):\n${JSON.stringify(context)}`,
      config: {
        systemInstruction: recommendationInstruction,
        responseMimeType: "application/json",
      },
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Permintaan Recommendation AI melebihi batas waktu.")), 20000));
    const response = await Promise.race([request, timeout]);
    return parseGeneralRecommendationResponse(response.text) || fallback;
  } catch (error) {
    console.error("Recommendation AI fallback:", error.message || error);
    return fallback;
  }
}
