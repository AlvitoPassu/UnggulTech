const ConditionStatus = ({ sensorData }) => {
  const moisture = sensorData?.moisture || 0;
  const temperature = sensorData?.temperature;

  return (
    <div className="bg-white rounded-xl p-6 shadow-md">
      <h3 className="text-xl font-semibold mb-6">
        Condition Status
      </h3>

      <div className="mb-6">
        <div className="flex justify-between">
          <span>Moisture</span>
          <span>{moisture}%</span>
        </div>

        <div className="w-full bg-gray-200 h-3 rounded-full mt-2">
          <div
            className="bg-blue-500 h-3 rounded-full"
            style={{ width: `${moisture}%` }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between">
          <span>Temperature</span>
          <span>{temperature === null || temperature === undefined ? "-" : `${temperature}°C`}</span>
        </div>

        <div className="w-full bg-gray-200 h-3 rounded-full mt-2">
          <div
            className="bg-green-500 h-3 rounded-full"
            style={{ width: `${Math.min((temperature || 0) * 2, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default ConditionStatus;