import SummaryCards from "../components/Dashboard/SummaryCards";
import AnalyticsChart from "../components/Dashboard/AnalyticsChart";
import ConditionStatus from "../components/Dashboard/ConditionStatus";
import RecentLogs from "../components/Dashboard/RecentLogs";

const DashboardPage = () => {
  return (
    <div className="p-6 bg-gray-100 min-h-screen">

      <h1 className="text-3xl font-bold mb-6">
        Smart Soil Monitoring System
      </h1>

      <SummaryCards />

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <AnalyticsChart />
        </div>

        <ConditionStatus />
      </div>

      <div className="mt-6">
        <RecentLogs />
      </div>
    </div>
  );
};

export default DashboardPage;