const RecentLogs = ({ logs }) => {
  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="text-xl font-semibold">
          Recent Logs
        </h3>
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
          {logs.map((log, index) => (
            <tr key={index}>
              <td className="p-3">{log.time}</td>
              <td className="p-3">{log.moisture}%</td>
              <td className="p-3">{log.temperature}°C</td>
              <td className="p-3">{log.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RecentLogs;
