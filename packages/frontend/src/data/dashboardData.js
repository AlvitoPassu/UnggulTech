import { FaCloudRain, FaTemperatureHigh, FaWind } from "react-icons/fa";
import { MdWaterDrop } from "react-icons/md";

export const summaryData = [
  {
    title: "Moisture",
    value: "42%",
    status: "Normal",
    icon: MdWaterDrop,
  },
  {
    title: "Temperature",
    value: "24°C",
    status: "Optimal",
    icon: FaTemperatureHigh,
  },
  {
    title: "Air Humidity",
    value: "65%",
    status: "Normal",
    icon: FaWind,
  },
  {
    title: "Rain Prediction",
    value: "82%",
    status: "High Chance",
    icon: FaCloudRain,
  },
];

export const logs = [
  {
    time: "08:30",
    moisture: "42%",
    temp: "24°C",
    action: "Watering",
  },
  {
    time: "09:10",
    moisture: "38%",
    temp: "25°C",
    action: "Fertilizing",
  },
  {
    time: "10:05",
    moisture: "45%",
    temp: "23°C",
    action: "Checking",
  },
];
