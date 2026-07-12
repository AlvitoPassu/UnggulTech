import { summaryData } from "../../data/dashboardData";

const SummaryCards = () => {
  return (
    <div className="grid grid-cols-3 gap-6">
      {summaryData.map((item, index) => {

        const Icon = item.icon;

        return (
          <div key={index} className="bg-white rounded-xl p-6 shadow">

            <div className="flex justify-between items-center">
              <h3>{item.title}</h3>

              <Icon className="text-3xl text-green-600" />
            </div>

            <h1 className="text-3xl font-bold mt-3">
              {item.value}
            </h1>

            <p>{item.status}</p>

          </div>
        );
      })}
    </div>
  );
};

export default SummaryCards;