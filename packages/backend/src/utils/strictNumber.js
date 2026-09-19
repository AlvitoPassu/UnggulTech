/**
 * Mengubah hanya angka finite atau string angka non-kosong menjadi number.
 * Nilai lain sengaja tidak dicoerce agar data hilang/invalid tidak berubah
 * menjadi angka operasional seperti 0 atau 1.
 */
export const parseStrictFiniteNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
};
