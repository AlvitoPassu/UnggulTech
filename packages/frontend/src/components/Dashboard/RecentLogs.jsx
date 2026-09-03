const RecentLogs = ({ logs }) => {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <h3 className="text-base font-bold text-slate-900">Recent Logs</h3>
        <p className="mt-1 text-xs text-slate-500">Aktivitas pembacaan sensor terbaru</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3 font-semibold">Time</th>
            <th className="px-5 py-3 font-semibold">Moisture</th>
            <th className="px-5 py-3 font-semibold">Temperature</th>
            <th className="px-5 py-3 font-semibold">Action</th>
          </tr>
        </thead>

        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan="4" className="p-5 text-center text-slate-500">
                Belum ada recent logs.
              </td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id}>
                <td className="border-t border-slate-100 px-5 py-3 text-slate-600">{log.time}</td>
                <td className="border-t border-slate-100 px-5 py-3 font-medium text-slate-800">{log.moisture ?? "-"}%</td>
                <td className="border-t border-slate-100 px-5 py-3 text-slate-600">{log.temperature === null ? "-" : `${log.temperature}°C`}</td>
                <td className="border-t border-slate-100 px-5 py-3 text-slate-600">{log.action}</td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
    </section>
  );
};

export default RecentLogs;
