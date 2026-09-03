import { FiArrowRight } from "react-icons/fi";
import { Link } from "react-router-dom";

const labels = { dry: "Kering", attention: "Perlu Perhatian", offline: "Offline" };
const colors = { dry: "bg-red-50 text-red-700", attention: "bg-orange-50 text-orange-700", offline: "bg-slate-100 text-slate-600" };

const AttentionBedengans = ({ sensors }) => <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-base font-bold text-slate-900">Bedengan Perlu Perhatian</h2><p className="mt-1 text-xs text-slate-500">Prioritas berdasarkan kondisi sensor</p><div className="mt-4 space-y-2">{sensors?.length ? sensors.map((sensor) => <div key={sensor.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0"><span className="font-medium text-slate-700">Bedengan {sensor.bedengan ?? "-"}</span><span className="text-slate-500">{sensor.moisture == null ? "-" : `${sensor.moisture}%`}</span><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${colors[sensor.category]}`}>{labels[sensor.category]}</span></div>) : <p className="py-5 text-center text-sm text-slate-400">Tidak ada bedengan yang perlu perhatian.</p>}</div><Link to="/sensor" className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-green-700 hover:text-green-800">Lihat semua peringatan <FiArrowRight aria-hidden="true" /></Link></section>;

export default AttentionBedengans;
