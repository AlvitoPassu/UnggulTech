import { useEffect, useMemo, useState } from "react";
import { downloadSensorReport } from "../../api/sensorApi";

const periodOptions = [
  { value: "daily", label: "Per Hari" },
  { value: "weekly", label: "Per Minggu" },
  { value: "monthly", label: "Per Bulan" },
  { value: "custom", label: "Rentang Tanggal" },
];

const statusOptions = ["", "Normal", "Kering", "Basah"];
const formatOptions = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "pdf", label: "PDF" },
];

const formatDateValue = (date) => date.toISOString().slice(0, 10);

const getWeekRange = (weekValue) => {
  const [year, week] = weekValue.split("-W").map(Number);
  const januaryFourth = new Date(year, 0, 4);
  const firstMonday = new Date(januaryFourth);
  firstMonday.setDate(januaryFourth.getDate() - ((januaryFourth.getDay() + 6) % 7));

  const startDate = new Date(firstMonday);
  startDate.setDate(firstMonday.getDate() + (week - 1) * 7);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  return {
    startDate: formatDateValue(startDate),
    endDate: formatDateValue(endDate),
  };
};

const getMonthRange = (monthValue) => {
  const [year, month] = monthValue.split("-").map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return {
    startDate: formatDateValue(startDate),
    endDate: formatDateValue(endDate),
  };
};

const getFilename = (contentDisposition, fallbackFilename) => {
  const filenameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);

  return filenameMatch ? decodeURIComponent(filenameMatch[1]) : fallbackFilename;
};

const DownloadDataModal = ({ sensors, selectedSensorId, onClose }) => {
  const [sensorId, setSensorId] = useState(selectedSensorId);
  const [period, setPeriod] = useState("daily");
  const [date, setDate] = useState("");
  const [week, setWeek] = useState("");
  const [month, setMonth] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("");
  const [format, setFormat] = useState("csv");
  const [isDownloading, setIsDownloading] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !isDownloading) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDownloading, onClose]);

  const selectedSensor = sensors.find((sensor) => sensor.id === sensorId);
  const dateRange = useMemo(() => {
    if (period === "daily" && date) {
      return { startDate: date, endDate: date };
    }

    if (period === "weekly" && week) {
      return getWeekRange(week);
    }

    if (period === "monthly" && month) {
      return getMonthRange(month);
    }

    if (period === "custom" && startDate && endDate && startDate <= endDate) {
      return { startDate, endDate };
    }

    return null;
  }, [date, endDate, month, period, startDate, week]);

  const isFormValid = Boolean(sensorId && dateRange && format);

  const handleDownload = async (event) => {
    event.preventDefault();

    if (!isFormValid) {
      return;
    }

    setIsDownloading(true);
    setNotification(null);

    try {
      const response = await downloadSensorReport({
        sensorId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        format,
        status: status || undefined,
      });
      const extension = format === "xlsx" ? "xlsx" : format;
      const fallbackFilename = `Laporan_Bedengan${selectedSensor?.bedengan}_${dateRange.startDate}${dateRange.endDate !== dateRange.startDate ? `_sampai_${dateRange.endDate}` : ""}.${extension}`;
      const fileUrl = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");

      link.href = fileUrl;
      link.download = getFilename(response.headers["content-disposition"], fallbackFilename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(fileUrl);
      setNotification({ type: "success", message: "Laporan berhasil diunduh." });
    } catch {
      setNotification({
        type: "error",
        message: "Download gagal. Pastikan layanan laporan backend sudah tersedia.",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-data-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDownloading) {
          onClose();
        }
      }}
    >
      <form onSubmit={handleDownload} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 id="download-data-title" className="text-2xl font-bold text-gray-900">Download Data</h2>
            <p className="mt-1 text-sm text-gray-600">Pilih data sensor dan periode laporan yang ingin diunduh.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isDownloading} className="text-2xl leading-none text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed" aria-label="Tutup modal">&times;</button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
            Pilih Sensor / Bedengan
            <select value={sensorId} onChange={(event) => setSensorId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200">
              <option value="">Pilih bedengan</option>
              {sensors.map((sensor) => <option key={sensor.id} value={sensor.id}>Bedengan {sensor.bedengan} - {sensor.name}</option>)}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Rentang Waktu
            <select value={period} onChange={(event) => setPeriod(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200">
              {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {period === "daily" && <label className="block text-sm font-medium text-gray-700">Pilih Tanggal<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" /></label>}
          {period === "weekly" && <label className="block text-sm font-medium text-gray-700">Pilih Minggu<input type="week" value={week} onChange={(event) => setWeek(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" /></label>}
          {period === "monthly" && <label className="block text-sm font-medium text-gray-700">Pilih Bulan<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" /></label>}
          {period === "custom" && <>
            <label className="block text-sm font-medium text-gray-700">Tanggal Mulai<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" /></label>
            <label className="block text-sm font-medium text-gray-700">Tanggal Selesai<input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" /></label>
          </>}

          <label className="block text-sm font-medium text-gray-700">
            Filter Status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200">
              {statusOptions.map((option) => <option key={option || "all"} value={option}>{option || "Semua Status"}</option>)}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Format File
            <select value={format} onChange={(event) => setFormat(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200">
              {formatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {period === "custom" && startDate && endDate && startDate > endDate && <p className="mt-3 text-sm text-red-600">Tanggal selesai harus setelah tanggal mulai.</p>}
        {dateRange && <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Laporan akan mencakup data dari {dateRange.startDate} sampai {dateRange.endDate}.</p>}
        {notification && <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${notification.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{notification.message}</p>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={isDownloading} className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed">Batal</button>
          <button type="submit" disabled={!isFormValid || isDownloading} className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300">
            {isDownloading ? "Menyiapkan file..." : "Download Data"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default DownloadDataModal;
