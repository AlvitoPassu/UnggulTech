import { BED_NUMBERS, sensorsForBed } from "./sensorMapModel";

export default function NurseryMap({ sensors, location, selectedBed, onSelect }) {
  return <div className="nursery-map mt-5">
    <div className="nursery-beds grid grid-cols-6 gap-x-2 gap-y-3 sm:gap-x-5 sm:gap-y-4" role="group" aria-label="Pilih satu dari 60 bedengan">
      {BED_NUMBERS.map((bed) => {
        const count = sensorsForBed(sensors, location, bed).length;
        return <button type="button" key={bed} aria-pressed={selectedBed === bed}
          aria-label={`Bedengan ${bed}, ${count} sensor terdaftar`}
          onClick={() => onSelect(bed)}
          className={`bed-button relative min-h-11 rounded-md border-2 px-1 py-2 text-xs font-semibold transition-colors sm:text-sm ${selectedBed === bed ? "border-[#1DAADF] bg-[#e8f7fc] text-[#1686b3]" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"}`}>
          B{bed}
          {count > 0 && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#1DAADF]" />}
        </button>;
      })}
    </div>
    <div className="main-pipe" aria-hidden="true" />
    <div className="mt-5 flex items-center justify-end gap-3 pr-1 text-xs text-slate-500">
      <span>Jalur pipa utama</span><span className="water-source rounded-md border border-sky-200 bg-sky-50 px-3 py-2 font-medium text-[#1686b3]">Sumber air</span>
    </div>
  </div>;
}
