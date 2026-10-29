const text = (value) => typeof value === "string";
const list = (value, check) => Array.isArray(value) && value.every(check);

export const isAgronomyAnalysis = (value) => Boolean(value && text(value.problem?.summary)
  && ["low", "medium", "high"].includes(value.problem?.confidence)
  && list(value.causes, (item) => text(item?.cause) && text(item?.reason) && ["possible", "supported", "confirmed"].includes(item.status))
  && list(value.solutions, (item) => text(item?.action) && text(item?.reason) && Number.isInteger(item.priority))
  && list(value.prevention, (item) => text(item?.action))
  && list(value.additional_checks, text)
  && list(value.sources, (item) => text(item?.title)));

export function safeReferenceUrl(source) {
  try {
    const value = source?.url || (typeof source?.doi === "string" && /^10\.\d{4,9}\/\S+$/.test(source.doi) ? `https://doi.org/${source.doi}` : "");
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
