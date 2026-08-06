const sensors = [
  { id: "sensor-01", name: "Sensor 1", bedengan: 5 },
  { id: "sensor-02", name: "Sensor 2", bedengan: 12 },
  { id: "sensor-03", name: "Sensor 3", bedengan: 18 },
  { id: "sensor-04", name: "Sensor 4", bedengan: 27 },
  { id: "sensor-05", name: "Sensor 5", bedengan: 34 },
  { id: "sensor-06", name: "Sensor 6", bedengan: 46 },
  { id: "sensor-07", name: "Sensor 7", bedengan: 53 },
  { id: "sensor-08", name: "Sensor 8", bedengan: 67 },
  { id: "sensor-09", name: "Sensor 9", bedengan: 78 },
  { id: "sensor-10", name: "Sensor 10", bedengan: 91 },
];

const baseLogs = [
  { time: "08:30", moisture: 42, temperature: 24, action: "Watering" },
  { time: "09:10", moisture: 38, temperature: 25, action: "Fertilizing" },
  { time: "10:05", moisture: 45, temperature: 23, action: "Checking" },
];

const getSensorIndex = (sensorId) => {
  const index = sensors.findIndex((sensor) => sensor.id === sensorId);

  return index >= 0 ? index : 0;
};

// Sementara menggunakan mock data. Ganti isi fungsi ini dengan GET /api/sensors
// saat backend tersedia; komponen dashboard tidak perlu diubah.
export const getSensors = async () => {
  return sensors;
};

// Sementara menggunakan mock data. Nantinya dapat diganti dengan
// GET /api/sensors/:sensorId/dashboard.
export const getSensorData = async (sensorId) => {
  const index = getSensorIndex(sensorId);
  const moisture = 42 + (index % 4) * 3;
  const temperature = 24 + (index % 3);

  return {
    moisture,
    temperature,
    pump: index % 2 === 0 ? "Active" : "Standby",
    status: moisture >= 40 ? "Normal" : "Low",
    chart: [
      { time: "06:00", moisture: moisture - 4 },
      { time: "09:00", moisture: moisture + 2 },
      { time: "12:00", moisture: moisture - 1 },
      { time: "15:00", moisture: moisture + 4 },
      { time: "18:00", moisture },
    ],
    logs: baseLogs.map((log) => ({
      ...log,
      moisture: log.moisture + index,
      temperature: log.temperature + (index % 3),
    })),
  };
};
