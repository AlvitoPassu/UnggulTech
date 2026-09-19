const normalizeMoisture = (input) => {
  if (input === null || input === undefined || typeof input === "boolean") return null;

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "") return null;
    input = Number(trimmed);
  } else if (typeof input !== "number") {
    return null;
  }

  if (!Number.isFinite(input) || input < 0 || input > 100) return null;
  return input;
};

/**
 * Mengklasifikasikan nilai soil moisture pada application layer.
 * Tidak melakukan I/O dan hanya menerima nilai numerik valid dalam rentang 0-100.
 */
export const classifyMoisture = (input) => {
  const value = normalizeMoisture(input);

  if (value === null) {
    return {
      value: null,
      condition: null,
      needsAttention: false,
      legacyStatus: null,
    };
  }

  if (value <= 30) {
    return {
      value,
      condition: "dry",
      needsAttention: true,
      legacyStatus: "Low",
    };
  }

  if (value <= 70) {
    return {
      value,
      condition: "normal",
      needsAttention: false,
      legacyStatus: "Normal",
    };
  }

  return {
    value,
    condition: "wet",
    needsAttention: false,
    legacyStatus: "High",
  };
};

export default classifyMoisture;
