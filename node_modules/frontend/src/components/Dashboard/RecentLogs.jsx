const RecentLogs = ({ logs }) => {
  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="text-xl font-semibold">Recent Logs</h3>
      </div>

      <table className="w-full">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-3">Time</th>
            <th className="p-3">Moisture</th>
            <th className="p-3">Temperature</th>
            <th className="p-3">Action</th>
          </tr>
        </thead>

        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan="4" className="p-4 text-center text-gray-500">
                Belum ada recent logs.
              </td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id}>
                <td className="p-3">{log.time}</td>
                <td className="p-3">{log.moisture ?? "-"}%</td>
                <td className="p-3">{log.temperature === null ? "-" : `${log.temperature}°C`}</td>
                <td className="p-3">{log.action}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default RecentLogs;
