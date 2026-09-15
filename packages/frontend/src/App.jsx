import { BrowserRouter, Routes, Route } from "react-router-dom";

import DashboardPage from "./pages/DashboardPage";
import SensorPage from "./pages/SensorPage";
import AppLayout from "./components/Layout/AppLayout";
import HistoricalDataPage from "./pages/HistoricalDataPage";
import RecommendationAIPage from "./pages/RecommendationAIPage";
import { AuthProvider } from "./context/AuthContext";
import LoginModal from "./components/Auth/LoginModal";
import SessionTimeoutWarningModal from "./components/Auth/SessionTimeoutWarningModal";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/sensor" element={<SensorPage />} />
            <Route path="/data-historis" element={<HistoricalDataPage />} />
            <Route path="/rekomendasi-ai" element={<RecommendationAIPage />} />
          </Route>
        </Routes>
        <LoginModal />
        <SessionTimeoutWarningModal />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;