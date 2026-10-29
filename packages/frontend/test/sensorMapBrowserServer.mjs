// Isolated, loopback-only browser fixture. Never starts the real backend or DB.
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.SENSOR_MAP_TEST_PORT || 5181);
const registry = [
  { id: 701, sensor_name: "Sensor uji 701", bedengan: "1", location: "Nursery pengujian", placement: { row: 1, column: 1 } },
  { id: 702, sensor_name: "Sensor uji 702", bedengan: "2", location: "Nursery pengujian", placement: { row: 1, column: 100 } },
  { id: 703, sensor_name: "Sensor uji 703", bedengan: "3", location: "Nursery pengujian", placement: { row: 10, column: 1 } },
  { id: 704, sensor_name: "Sensor uji 704", bedengan: "4", location: "Nursery pengujian", placement: { row: 10, column: 100 } },
  // Deliberately invalid legacy coordinate: list access must survive without a marker.
  { id: 705, sensor_name: "Sensor uji 705", bedengan: "5", location: "Nursery pengujian", placement: { row: 11, column: 40 } },
  { id: 706, sensor_name: "Sensor uji 706", bedengan: "6", location: "Nursery pengujian", placement: null },
].map((sensor) => ({ ...sensor, status: "Active" }));
const initialState = () => ({ calls: {}, writes: [], extraSensor: false, moisture: 55, health: "online", detailError: false, logsError: false, emptyReadings: false, phError: false, phHistoryError: false, registryError: false, empty: false, missingLocation: false, invalidBed: false, delay: 0, delaySensorId: "701", measuredAt: new Date().toISOString(),
  placementMode: "json", placements: {}, placementStates: {}, writeEnabled: true, saveStatus: 200, saveCode: "",
  writeDelay: 0, registryDelay: 0, registryStale: false, malformedSave: false });
let state = initialState();
let results = null;
const fixtureRegistry = () => state.extraSensor ? [...registry, { id: 707, sensor_name: "Sensor uji 707", bedengan: "6", location: "Nursery pengujian", placement: { row: 2, column: 3 }, status: "Active" }] : registry;
const dbSensor = (sensor, allowStale = true) => {
  const saved = (!allowStale || !state.registryStale) && state.placements[sensor.id];
  const valid = sensor.placement && sensor.placement.row <= 10;
  const placementState = state.placementStates[sensor.id] || (saved || valid ? "configured" : sensor.placement ? "invalid" : "unconfigured");
  const placement = placementState === "configured" ? saved ? { sensorId: saved.sensorId, ...saved.placement,
    context: saved.context, version: saved.version, updatedAt: saved.updatedAt }
    : { sensorId: String(sensor.id), ...sensor.placement, context: { location: sensor.location, bedengan: Number(sensor.bedengan) },
      version: "1", updatedAt: "2026-10-29T00:00:00.000Z" } : null;
  return { ...sensor, id: String(sensor.id), placementSource: "db", placementState, placement };
};
const server = httpServer(async (req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (path === "/__test__/reset" && req.method === "POST") {
    state = initialState();
    results = null;
    return json(state);
  }
  if (path === "/__test__/results") {
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      results = JSON.parse(body);
    }
    return json(results);
  }
  if (path === "/__test__/state") {
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      Object.assign(state, JSON.parse(body));
    }
    return json(state);
  }
  if (path.startsWith("/api/")) {
    state.calls[path] = (state.calls[path] || 0) + 1;
    const placementMatch = /^\/api\/sensors\/([1-9][0-9]*)\/placement$/.exec(path);
    if (req.method === "PUT" && placementMatch) {
      let body = ""; for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body), id = placementMatch[1];
      const authorized = req.headers.authorization === "Bearer local-browser-operator" && req.headers["x-session-id"] === "local-browser-session";
      state.writes.push({ path, method: req.method, payload, authorized });
      const error = (status, code) => json({ code, message: "Synthetic placement rejection" }, status);
      if (!authorized) return error(401, "SESSION_NOT_FOUND");
      if (!state.writeEnabled) return error(503, "SENSOR_PLACEMENT_WRITE_DISABLED");
      if (state.placementMode !== "db") return error(503, "SENSOR_PLACEMENT_READ_NOT_READY");
      if (state.saveStatus !== 200) return error(state.saveStatus, state.saveCode || `FIXTURE_${state.saveStatus}`);
      const sensor = fixtureRegistry().find((item) => String(item.id) === id);
      if (!sensor) return error(404, "SENSOR_NOT_FOUND");
      if (!Number.isInteger(payload.row) || payload.row < 1 || payload.row > 10 || !Number.isInteger(payload.column)
        || payload.column < 1 || payload.column > 100) return error(400, "INVALID_PLACEMENT");
      if (payload.expectedContext?.location !== sensor.location || payload.expectedContext?.bedengan !== Number(sensor.bedengan)) return error(409, "SENSOR_CONTEXT_CHANGED");
      const previous = dbSensor(sensor, false).placement;
      if (payload.expectedVersion !== (previous?.version ?? null)) return error(409, "PLACEMENT_VERSION_CONFLICT");
      if (fixtureRegistry().some((other) => String(other.id) !== id && other.location === sensor.location && other.bedengan === sensor.bedengan
        && dbSensor(other, false).placement?.row === payload.row && dbSensor(other, false).placement?.column === payload.column)) return error(409, "PLACEMENT_OCCUPIED");
      const unchanged = previous?.row === payload.row && previous?.column === payload.column;
      const result = { code: "OK", sensorId: id, placement: { row: payload.row, column: payload.column }, context: payload.expectedContext,
        version: unchanged ? previous.version : previous ? String(BigInt(previous.version) + 1n) : "1",
        updatedAt: unchanged ? previous.updatedAt : new Date().toISOString(), unchanged };
      state.placements[id] = result;
      const delay = state.writeDelay, malformed = state.malformedSave;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return json(malformed ? { code: "OK" } : result);
    }
    if (req.method !== "GET") { state.writes.push({ path, method: req.method }); return json({ message: "Test fixture is read only" }, 405); }
    if (path === "/api/sensors") {
      const sensors = state.empty ? [] : fixtureRegistry().map((sensor) => ({ ...(state.placementMode === "db" ? dbSensor(sensor) : sensor),
      location: state.missingLocation && sensor.id === 706 ? null : sensor.location,
      bedengan: state.invalidBed && sensor.id === 705 ? null : sensor.bedengan,
      }));
      const status = state.registryError ? 503 : 200, delay = state.registryDelay;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return json(sensors, status);
    }
    if (path === "/api/sensors/ph") return json({ soilPh: 6.4, status: "active", measuredAt: state.measuredAt }, state.phError ? 503 : 200);
    if (path === "/api/sensors/ph/history") return json({ readings: [{ soilPh: 6.4, measuredAt: state.measuredAt }] }, state.phHistoryError ? 503 : 200);
    const match = /^\/api\/sensors\/(\d+)\/(data|recent-logs)$/.exec(path);
    if (match) {
      const sensor = fixtureRegistry().find((item) => String(item.id) === match[1]);
      if (!sensor) return json({}, 404);
      const snapshot = { ...state };
      // Distinct values expose requests accidentally sent with a previous sensor ID.
      const moisture = snapshot.moisture + sensor.id - 701;
      if (snapshot.delay && match[1] === snapshot.delaySensorId) await new Promise((resolve) => setTimeout(resolve, snapshot.delay));
      if (snapshot.detailError) return json({ message: "Expected test error" }, 503);
      if (snapshot.logsError && match[2] === "recent-logs") return json({ message: "Expected logs error" }, 503);
      if (snapshot.emptyReadings) return json(match[2] === "recent-logs" ? [] : { sensor, moisture: null, chart: [], lastSeen: null });
      if (match[2] === "recent-logs") return json([{ id: 1, moisture, condition: "normal", time: "27 Okt 2026 08:00:00" }]);
      return json({ sensor, moisture, temperature: null, humidity: null, condition: "normal", needsAttention: false,
        sensorHealth: snapshot.health, isOnline: snapshot.health === "online", lastSeen: snapshot.measuredAt,
        chart: [{ time: "08:00", moisture }] });
    }
    return json({}, 404);
  }
  vite.middlewares(req, res);
});
const vite = await createServer({ root, configFile: false, envDir: false, plugins: [{
  // Only this isolated test server replaces the auth hook. Production auth is untouched.
  name: "sensor-position-test-auth", enforce: "pre",
  transformIndexHtml() {
    return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data: blob:;" }, injectTo: "head-prepend" }, { tag: "script", injectTo: "head-prepend", children: `
      let reportedBootError = false;
      const reportBootError = event => {
        const message = event.message || event.reason?.stack || event.reason;
        if (!message || reportedBootError) return;
        reportedBootError = true;
        fetch('/__test__/results', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ failures: 1, outcomes: [{ name: 'Browser runtime ' + location.pathname, passed: false, error: String(message) }] }) });
      };
      window.addEventListener('error', reportBootError);
      window.addEventListener('unhandledrejection', reportBootError);
    ` }];
  },
  resolveId(source) { if (source.endsWith("/context/AuthContext")) return "\0sensor-position-test-auth"; },
  load(id) {
    if (id === "\0sensor-position-test-auth") return `
      import { createContext, createElement, useContext, useEffect, useState } from 'react';
      import axios from 'axios';
      const AuthContext = createContext(null);
      export function AuthProvider({ children }) {
        const [auth, setAuth] = useState({ isAuthenticated: false, secondsRemaining: 0 });
        const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
        useEffect(() => {
          const update = (event) => setAuth(event.detail);
          window.addEventListener('sensor-test-auth-change', update);
          return () => window.removeEventListener('sensor-test-auth-change', update);
        }, []);
        useEffect(() => {
          const request = axios.interceptors.request.use((config) => {
            if (auth.isAuthenticated && auth.secondsRemaining > 0 && config.url.startsWith('/api/')) {
              config.headers.Authorization = 'Bearer local-browser-operator';
              config.headers['X-Session-Id'] = 'local-browser-session';
            }
            return config;
          });
          const response = axios.interceptors.response.use(value => value, error => {
            if (error.response?.status === 401) setAuth({ isAuthenticated: false, secondsRemaining: 0 });
            return Promise.reject(error);
          });
          return () => { axios.interceptors.request.eject(request); axios.interceptors.response.eject(response); };
        }, [auth]);
        const value = { ...auth, user: { email: 'operator@fixture.invalid' }, authStatus: auth.isAuthenticated ? 'authenticated' : 'unauthenticated',
          isLoginModalOpen, openLoginModal: () => setIsLoginModalOpen(true), closeLoginModal: () => setIsLoginModalOpen(false),
          sessionId: auth.isAuthenticated ? 'local-browser-session' : null,
          executeProtectedAction: action => auth.isAuthenticated && auth.secondsRemaining > 0 ? action() : setIsLoginModalOpen(true),
          isWarningOpen: false, logout: () => setAuth({ isAuthenticated: false, secondsRemaining: 0 }) };
        return createElement(AuthContext.Provider, { value }, children);
      }
      export const useAuth = () => useContext(AuthContext);
    `;
  },
}, react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(`http://127.0.0.1:${port}`),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("local-browser-test-only"),
  }, server: { middlewareMode: true, hmr: { server }, watch: null },
});
server.listen(port, "127.0.0.1", () => console.log(`LOCAL TEST FIXTURE ONLY: http://127.0.0.1:${port}/test/sensor-map-browser.html`));
const shutdown = async () => { server.close(); await vite.close(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
