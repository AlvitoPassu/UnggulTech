const ConditionStatus = ({ sensorData }) => {
  const moisture = sensorData?.moisture || 0;
  const temperature = sensorData?.temperature;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-base font-bold text-slate-900">Condition Status</h3>
      <p className="mt-1 text-xs text-slate-500">Parameter utama bibit</p>

      <div className="mt-6 mb-5">
        <div className="flex justify-between text-sm">
          <span className="font-medium text-slate-600">Moisture</span>
          <span className="font-semibold text-slate-900">{moisture}%</span>
        </div>

        <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-[#1DAADF]"
            style={{ width: `${Math.min(Math.max(moisture, 0), 100)}%` }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between text-sm">
          <span className="font-medium text-slate-600">Temperature</span>
          <span className="font-semibold text-slate-900">{temperature === null || temperature === undefined ? "-" : `${temperature}°C`}</span>
        </div>

        <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-orange-500"
            style={{ width: `${Math.min((temperature || 0) * 2, 100)}%` }}
          />
        </div>
      </div>
    </section>
  );
};

export default ConditionStatus;
