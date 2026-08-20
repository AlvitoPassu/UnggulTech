import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config/supabase.js";
import sensorRoutes from "./routes/sensorRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import weatherRoutes from "./routes/weatherRoutes.js";

const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: config.allowedOrigins }));
app.use(express.json({ limit: "100kb" }));

// Health Check Endpoint
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Route Mounts
app.use("/api/sensors", sensorRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/weather", weatherRoutes);

// Global Error Handler
app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message || error);
  res.status(500).json({ message: "Terjadi kesalahan pada server backend." });
});

app.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
