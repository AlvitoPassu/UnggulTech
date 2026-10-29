import { isAgronomyAnalysis, safeReferenceUrl } from "../../lib/agronomyAnalysis";

const causeLabels = { possible: "Kemungkinan", supported: "Didukung data", confirmed: "Terkonfirmasi" };
const confidenceLabels = { low: "Rendah", medium: "Sedang", high: "Tinggi" };
const fallbackLabels = {
  kb_unavailable: "Knowledge Base belum dapat diakses.",
  retrieval_empty: "Belum ada research yang cukup relevan untuk pertanyaan ini.",
  llm_timeout: "Analisis AI melewati batas waktu. Berikut pemeriksaan awal yang aman.",
  llm_unavailable: "Analisis AI belum tersedia. Berikut pemeriksaan awal yang aman.",
  invalid_response: "Hasil AI belum memenuhi validasi. Berikut pemeriksaan awal yang aman.",
};

const AgronomyAnalysis = ({ analysis }) => {
  if (!isAgronomyAnalysis(analysis)) return null;
  return (
    <div className="space-y-4 whitespace-normal text-sm leading-6 text-slate-700" data-testid="agronomy-analysis">
      {fallbackLabels[analysis.evidence_status] && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="status">{fallbackLabels[analysis.evidence_status]}</p>}
      <section>
        <h3 className="font-bold text-slate-900">Masalah</h3>
        <p className="mt-1 break-words">{analysis.problem.summary}</p>
        <p className="mt-1 text-xs text-slate-500">Keyakinan analisis: {confidenceLabels[analysis.problem.confidence]}</p>
      </section>
      <section>
        <h3 className="font-bold text-slate-900">Kemungkinan Penyebab</h3>
        {analysis.causes.length ? <ul className="mt-1 space-y-2">{analysis.causes.map((item, index) => <li key={index}>
          <p>{item.cause} <span className="text-xs text-slate-500">({causeLabels[item.status]})</span></p>
          <p className="text-xs text-slate-500">{item.reason}</p>
        </li>)}</ul> : <p className="mt-1">Penyebab belum dapat ditentukan.</p>}
      </section>
      <section>
        <h3 className="font-bold text-slate-900">Solusi / Tindakan</h3>
        <ol className="mt-1 list-decimal space-y-2 pl-5">{analysis.solutions.map((item, index) => <li key={index}>
          <p>{item.action}</p><p className="text-xs text-slate-500">{item.reason}</p>
        </li>)}</ol>
      </section>
      <section>
        <h3 className="font-bold text-slate-900">Pencegahan / Tindakan Lanjutan</h3>
        <ul className="mt-1 list-disc pl-5">{analysis.prevention.map((item, index) => <li key={index}>{item.action}</li>)}</ul>
      </section>
      {analysis.additional_checks.length > 0 && <section>
        <h3 className="font-bold text-slate-900">Pemeriksaan Tambahan</h3>
        <ul className="mt-1 list-disc pl-5">{analysis.additional_checks.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </section>}
      <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer font-semibold text-[#1686b3]">Sumber ({analysis.sources.length}) · Lihat sumber</summary>
        {analysis.sources.length ? <ul className="mt-2 space-y-3">{analysis.sources.map((source, index) => {
          const url = safeReferenceUrl(source);
          return <li key={index} className="break-words text-xs">
            <p className="font-semibold">{source.title}</p>
            <p>{[source.institution, source.author, source.year].filter((value) => typeof value === "string" || typeof value === "number").join(" · ")}</p>
            {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#1686b3] underline">{source.doi || "Buka sumber"}</a>}
          </li>;
        })}</ul> : <p className="mt-2 text-xs text-slate-500">Bukti research yang tersedia belum mencukupi untuk rekomendasi spesifik.</p>}
      </details>
    </div>
  );
};

export default AgronomyAnalysis;
