import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/middleware/authMiddleware.js";
import rainfall from "../src/routes/rainfallRoutes.js";
import reports from "../src/routes/reportRoutes.js";
import sensors from "../src/routes/sensorRoutes.js";
import historical from "../src/routes/historicalRoutes.js";
import weather from "../src/routes/weatherRoutes.js";
import recommendation from "../src/routes/recommendationRoutes.js";
import chatbot from "../src/routes/chatbotRoutes.js";

test("existing operator actions stay protected by the global-session middleware", () => {
  for (const [router, method, path] of [[rainfall,"post","/"], [rainfall,"patch","/:id"], [reports,"post","/download"], [sensors,"put","/:sensorId/placement"]]) {
    const route = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method])?.route;
    assert.ok(route, `${method} ${path} exists`);
    assert.ok(route.stack.some((entry) => entry.handle === requireAuth), `${method} ${path} stays protected`);
  }
});

test("all existing public reads, chatbot and IoT ingestion remain independent of operator login", () => {
  for (const router of [sensors, historical, weather, recommendation, chatbot]) {
    for (const entry of router.stack.filter((item) => item.route)) {
      if (router === sensors && entry.route.path === "/:sensorId/placement" && entry.route.methods.put) continue;
      assert.equal(entry.route.stack.some((handler) => handler.handle === requireAuth), false, entry.route.path);
    }
  }
  for (const entry of rainfall.stack.filter((item) => item.route?.methods.get)) {
    assert.equal(entry.route.stack.some((handler) => handler.handle === requireAuth), false, entry.route.path);
  }
});
