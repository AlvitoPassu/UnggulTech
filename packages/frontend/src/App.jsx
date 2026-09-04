import { BrowserRouter, Routes, Route } from "react-router-dom";

import DashboardPage from "./pages/DashboardPage";
import SensorPage from "./pages/SensorPage";
import AppLayout from "./components/Layout/AppLayout";
import HistoricalDataPage from "./pages/HistoricalDataPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sensor" element={<SensorPage />} />
          <Route path="/data-historis" element={<HistoricalDataPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;