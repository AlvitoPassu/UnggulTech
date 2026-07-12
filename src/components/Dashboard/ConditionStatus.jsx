const ConditionStatus = () => {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md">
      <h3 className="text-xl font-semibold mb-6">
        Condition Status
      </h3>

      <div className="mb-6">
        <div className="flex justify-between">
          <span>Moisture</span>
          <span>65%</span>
        </div>

        <div className="w-full bg-gray-200 h-3 rounded-full mt-2">
          <div
            className="bg-blue-500 h-3 rounded-full"
            style={{ width: "65%" }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between">
          <span>Temperature</span>
          <span>24°C</span>
        </div>

        <div className="w-full bg-gray-200 h-3 rounded-full mt-2">
          <div
            className="bg-green-500 h-3 rounded-full"
            style={{ width: "50%" }}
          />
        </div>
      </div>
    </div>
  );
};

export default ConditionStatus;