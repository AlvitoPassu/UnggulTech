// No app module, AuthContext or API replacements. Drive the real application DOM.
const frame = document.querySelector("#app"), outcomes = [], errors = [];
const delay = ms => new Promise(done => setTimeout(done, ms));
const doc = () => frame.contentDocument, text = () => doc()?.body.innerText || "";
const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async (predicate, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("UI wait timeout"); await delay(50); }
};
const state = async () => (await fetch("/__e2e__/state")).json();
const control = async (action, extra = {}) => {
  const response = await fetch("/__e2e__/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data;
};
const named = name => [...doc().querySelectorAll("button")].find(button => button.textContent.trim() === name);
const form = () => doc()?.querySelector('form[aria-label="Atur Posisi Sensor"]');
const op = value => doc()?.querySelector(`[data-placement-operation="${value}"]`);
const writes = value => value.requests.filter(request => request.method === "PUT");
const position = (value, id = "126") => value.placements.find(item => item.id === id);
const marker = (row, column, id = "126") => doc().querySelector(`.sensor-marker[aria-label="Sensor ${id}, baris ${row}, kolom ${column}"]`);
const click = async target => { const node = typeof target === "string" ? doc().querySelector(target) : target; assert(node, `Missing ${target}`); node.click(); await delay(80); };
const input = async (node, value) => {
  Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype, "value").set.call(node, String(value));
  node.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true })); await delay(60);
};
const choose = async (id = "126", bed = 1) => {
  await click(`.bed-button[aria-label^="Bedengan ${bed},"]`);
  const button = [...doc().querySelectorAll("button")].find(item => item.textContent.startsWith(`Sensor ${id}`) && !item.classList.contains("sensor-marker"));
  await click(button); await wait(() => doc().querySelector('section[aria-label="Informasi sensor dan pengukuran global"] h2')?.textContent === `Sensor ${id}`);
};
const draft = async (row, column) => {
  if (!form()) await click(named("Atur Posisi Sensor"));
  assert(form(), "Editor not available");
  if (named("Muat Posisi Terbaru")) await click(named("Muat Posisi Terbaru"));
  await input(form().elements.namedItem("row"), row); await input(form().elements.namedItem("column"), column);
  form().requestSubmit(); await delay(80);
};
const cancel = async () => { if (form()) await click(named("Batal")); };
let page = 0;
const reload = async () => {
  if (doc()?.defaultView?.__e2eErrors) errors.push(...doc().defaultView.__e2eErrors);
  const query = `?e2e=${++page}`; frame.src = `/sensor${query}`;
  await wait(() => doc()?.location.search === query && doc().querySelectorAll(".bed-button").length === 60 && !text().includes("Memuat daftar sensor"));
};
const login = async () => {
  if (!doc().querySelector("#operator-identifier")) await click(named("Atur Posisi Sensor"));
  await wait(() => doc().querySelector("#operator-identifier"));
  await input(doc().querySelector("#operator-identifier"), "operator@fixture.invalid");
  await input(doc().querySelector("#operator-password"), "local-only-synthetic-password");
  doc().querySelector("#operator-identifier").closest("form").requestSubmit();
  await wait(() => doc().querySelector('button[aria-label="Logout"]'));
};
const test = async (name, action) => {
  const item = document.createElement("li"); document.querySelector("#results").append(item);
  try { await action(); outcomes.push({ name, passed: true }); item.className = "pass"; item.textContent = `PASS ${name}`; }
  catch (error) {
    const diagnostics = { url: doc()?.location.href, alerts: [...doc().querySelectorAll('[role="alert"]')].map(node => node.textContent), operation: doc().querySelector("[data-placement-operation]")?.textContent, editor: form()?.textContent, text: text().slice(-2200) };
    outcomes.push({ name, passed: false, error: `${error.stack} ${JSON.stringify(diagnostics)}` }); item.className = "fail"; item.textContent = `FAIL ${name}: ${error.message}`;
    throw error;
  }
};

try {
  await reload(); await choose();
  await test("Integrated UI: 60 beds, 10 x 100 seedlings; unconfigured sensor has no invented marker", async () => {
    assert(doc().querySelectorAll(".bed-button").length === 60, "Bed count");
    const points = [...doc().querySelectorAll("[data-seedling]")];
    assert(points.length === 1000 && new Set(points.map(p => p.getAttribute("cy"))).size === 10 && new Set(points.map(p => p.getAttribute("cx"))).size === 100, "Seedling layout");
    assert(!doc().querySelector(".sensor-marker"), "Invented placement");
    await wait(() => text().includes("55%") && text().includes("6.4"));
  });
  await test("Integrated auth: guest uses actual global login modal, SDK and admission RPC before editing", async () => {
    await click(named("Atur Posisi Sensor")); assert(!form() && doc().querySelector("#login-modal-title"), "Guest can edit");
    assert(writes(await state()).length === 0, "Guest PUT"); await login();
    await click(named("Atur Posisi Sensor")); assert(form() && form().elements.namedItem("row").value === "", "Login did not unlock empty editor");
    await click(named("Batal")); assert(!form(), "Cancel did not clear draft");
  });
  await test("Integrated first placement B1 (1,1): double click locks PUT; real SQL audit and immediate GET refresh", async () => {
    const before = await state(); await control("fault", { patch: { delay: 600 } }); await draft(1, 1);
    const save = named("Simpan Posisi"); assert(save && !save.disabled, "Save disabled"); save.click(); save.click(); await delay(100);
    assert(form().elements.namedItem("row").disabled && !op("success"), "Premature success or unlocked input");
    await wait(() => op("success") && marker(1, 1)); const after = await state();
    assert(writes(after).length === writes(before).length + 1 && after.audits === before.audits + 1, "Duplicate PUT/audit");
    const request = writes(after).at(-1); assert(request.body.expectedVersion === null && request.body.expectedContext.location === (after.nullLocation ? null : "Nursery test") && request.body.expectedContext.bedengan === 1 && request.path === "/api/sensors/126/placement", "Incorrect real ID/context");
    assert(position(after).version === "1" && marker(1, 1).getAttribute("aria-pressed") === "true", "Version or selection lost");
    assert(after.requests.filter(r => r.path === "/api/sensors").length > before.requests.filter(r => r.path === "/api/sensors").length, "No immediate registry GET");
    await control("fault", { patch: {} });
  });
  await test("Integrated update B1 (10,100): server increments string version and replaces single marker", async () => {
    await draft(10, 100); assert(text().includes("Versi posisi: 1"), "Old version absent"); await click(named("Simpan Posisi"));
    await wait(() => op("success") && marker(10, 100)); const after = await state();
    assert(position(after).version === "2" && writes(after).at(-1).body.expectedVersion === "1", "Version not advanced");
    assert(doc().querySelectorAll(".sensor-marker").length === 1, "Duplicate markers");
  });
  await test("Integrated persistence: real document reload restores SDK session, placement, ID and latest version", async () => {
    await reload(); await choose(); await wait(() => doc().querySelector('button[aria-label="Logout"]'));
    assert(marker(10, 100) && doc().querySelectorAll(".sensor-marker").length === 1, "Refresh lost SQL placement");
    await draft(10, 100); assert(text().includes("Versi posisi: 2"), "Refresh lost version"); await cancel();
  });
  await test("Integrated persistence: backend process restart retains SAME PG database; edit uses latest version", async () => {
    const before = await state(), after = await control("restart");
    assert(before.cluster === after.cluster && before.pidHistory.at(-1) !== after.pidHistory.at(-1), "Not a real same-DB process restart");
    await reload(); await choose(); await wait(() => doc().querySelector('button[aria-label="Logout"]'));
    assert(marker(10, 100), "Backend restart lost placement"); await draft(3, 33); assert(text().includes("Versi posisi: 2"), "Stale version after restart");
    await click(named("Simpan Posisi")); await wait(() => op("success") && marker(3, 33)); assert(position(await state()).version === "3", "Restart update failed");
  });
  await test("Integrated conflict: second sensor cannot occupy same bed point or produce false success audit", async () => {
    const before = await state(); await choose("127"); await draft(3, 33); await click(named("Simpan Posisi")); await wait(() => op("error"));
    const after = await state(); assert(!position(after, "127") && after.audits === before.audits && marker(3, 33) && !op("success"), "Collision committed");
    await cancel(); await choose();
  });
  await test("Integrated validation: invalid input never sends PUT; steppers stop at limits; point click, preview and cancel work", async () => {
    const count = writes(await state()).length;
    for (const [row, column] of [[0, 1], [-1, 1], [1.5, 1], [11, 1], [1, 0], [1, 101], ["", ""]]) {
      await draft(row, column); assert(named("Simpan Posisi").disabled, "Invalid save enabled"); named("Simpan Posisi").click();
    }
    await draft(1, 1); assert(doc().querySelector('[aria-label="Kurangi baris"]').disabled && doc().querySelector('[aria-label="Kurangi kolom"]').disabled, "Minimum not enforced");
    doc().querySelectorAll("[data-seedling]")[999].dispatchEvent(new frame.contentWindow.MouseEvent("click", { bubbles: true })); await delay(100);
    assert(form().elements.namedItem("row").value === "10" && form().elements.namedItem("column").value === "100", "Point click mismatch");
    assert(doc().querySelector('[aria-label="Tambah baris"]').disabled && doc().querySelector('[aria-label="Tambah kolom"]').disabled && named("Simpan Posisi").disabled, "Maximum or preview gate incorrect");
    form().requestSubmit(); await delay(100); assert(doc().querySelector(".sensor-position-preview"), "Preview absent"); await cancel();
    assert(marker(3, 33) && !doc().querySelector(".sensor-position-preview") && writes(await state()).length === count, "Preview wrote position");
  });
  await test("Integrated version conflict: independent RPC wins; stale browser PUT 409 reads it without overwrite/retry", async () => {
    await draft(6, 66); const before = await state(); await control("externalUpdate"); await click(named("Simpan Posisi"));
    await wait(() => op("error") && marker(8, 88)); const after = await state();
    assert(position(after).version === "4" && after.audits === before.audits + 1 && writes(after).length === writes(before).length + 1 && !op("success"), "Stale version overwrote winner"); await cancel();
  });
  await test("Integrated context drift: real registry metadata change rejects stale PUT, warns and blocks automatic overwrite", async () => {
    const before = await state(); await draft(6, 66); await control("contextDrift", { enabled: true }); await click(named("Simpan Posisi"));
    await wait(() => !form()); await choose("126", 2); await click(named("Atur Posisi Sensor"));
    assert(text().includes("Lokasi atau bedengan posisi berbeda") && form(), "Missing context mismatch warning");
    await input(form().elements.namedItem("row"), "6"); await input(form().elements.namedItem("column"), "66"); form().requestSubmit(); await delay(100);
    assert(named("Simpan Posisi").disabled && !doc().querySelector(".sensor-marker"), "Mismatched position guessed/overwritten");
    const after = await state(); assert(after.audits === before.audits && position(after).version === "4" && writes(after).at(-1).status === 409, "Context conflict committed");
    await control("contextDrift", { enabled: false }); await reload(); await choose(); await wait(() => doc().querySelector('button[aria-label="Logout"]'));
  });
  await test("Integrated flag off: actual API 503 retains placement and never displays success", async () => {
    await control("configure", { patch: { flag: "false" } }); const before = await state(); await draft(4, 44); await click(named("Simpan Posisi")); await wait(() => op("error"));
    const after = await state(); assert(marker(8, 88) && !op("success") && after.audits === before.audits, "Flag-off false success");
    await control("configure", { patch: { flag: "true" } }); await cancel();
  });
  await test("Integrated timeout AFTER actual commit: real 10s Axios timeout reconciles via GET only; outcome stays uncertain", async () => {
    const before = await state(); await control("fault", { patch: { delay: 11000 } }); await draft(5, 55); await click(named("Simpan Posisi"));
    await wait(() => op("warning") && marker(5, 55), 20000); const after = await state();
    assert(!op("success") && position(after).version === "5" && after.audits === before.audits + 1 && writes(after).length === writes(before).length + 1, "Timeout retried or false success");
    await control("fault", { patch: {} }); await cancel();
  });
  await test("Integrated malformed response AFTER commit + failed readback: no success; Periksa Posisi issues GET only", async () => {
    const before = await state(); await control("fault", { patch: { malformed: true, readback: true } }); await draft(6, 66); await click(named("Simpan Posisi"));
    await wait(() => op("needs_read")); assert(!op("success"), "Malformed response accepted");
    await control("fault", { patch: {} }); await click(named("Periksa Posisi")); await wait(() => op("warning") && marker(6, 66));
    const after = await state(); assert(position(after).version === "6" && writes(after).length === writes(before).length + 1 && after.audits === before.audits + 1, "Recheck replayed write"); await cancel();
  });
  await test("Integrated valid commit + failed readback: confirmed marker retained, success deferred until read ready", async () => {
    const before = await state(); await control("fault", { patch: { readback: true } }); await draft(7, 77); await click(named("Simpan Posisi"));
    await wait(() => op("needs_read") && marker(7, 77)); assert(!op("success"), "Read failure shown as fully ready");
    await control("fault", { patch: {} }); await click(named("Periksa Posisi")); await wait(() => op("success"));
    assert(writes(await state()).length === writes(before).length + 1, "Readback repeated PUT");
  });
  await test("Integrated pending request: changing sensor drops draft; late result cannot replace selected sensor", async () => {
    const before = await state(); await control("fault", { patch: { delay: 1200 } }); await draft(9, 99); await click(named("Simpan Posisi")); await choose("127");
    assert(!form(), "Draft survived sensor change"); await wait(() => marker(9, 99));
    assert(doc().querySelector('section[aria-label="Informasi sensor dan pengukuran global"] h2').textContent === "Sensor 127" && !form(), "Late result replaced selection");
    const after = await state(); assert(position(after).version === "8" && writes(after).length === writes(before).length + 1, "Pending write lost/retried");
    await control("fault", { patch: {} }); await choose(); assert(marker(9, 99), "Confirmed marker absent");
  });
  await test("Integrated DB SELECT unavailable: GET reports unavailable, never JSON; save disabled while monitoring continues", async () => {
    await control("placementAccess", { enabled: false }); await reload(); await choose(); await wait(() => doc().querySelector('button[aria-label="Logout"]'));
    const registry = await (await fetch("/api/sensors")).json(); assert(registry.find(s => s.id === "126").placementState === "unavailable", "Outage interpreted as unconfigured");
    assert(!doc().querySelector(".sensor-marker"), "Fallback JSON marker"); await draft(2, 22); assert(named("Simpan Posisi").disabled, "Unavailable source writes");
    await wait(() => text().includes("55%") && text().includes("6.4")); assert(!text().includes("Offline"), "Placement failure changed monitoring status");
    await control("placementAccess", { enabled: true }); await reload(); await choose();
  });
  await test("Integrated JSON mode: preview available, permanent save disabled with zero PUT", async () => {
    await control("configure", { patch: { source: "json" } }); await reload(); await choose(); await wait(() => doc().querySelector('button[aria-label="Logout"]'));
    const before = writes(await state()).length; await draft(2, 22); assert(named("Simpan Posisi").disabled && doc().querySelector(".sensor-position-preview"), "JSON preview/save gate");
    named("Simpan Posisi").click(); await delay(100); assert(writes(await state()).length === before, "JSON sent PUT");
    await control("configure", { patch: { source: "db" } }); await reload(); await choose(); assert(marker(9, 99), "DB position lost after JSON test");
  });
  await test("Integrated UI: desktop and smartphone fit; touch controls, editor and chatbot bubble stay inside viewport", async () => {
    await wait(() => doc().querySelector('button[aria-label="Logout"]')); await draft(10, 100);
    for (const width of [1440, 768, 375, 320]) {
      frame.width = width; await delay(200);
      assert(doc().documentElement.scrollWidth <= width, `Page overflow ${width}`);
      assert(doc().querySelector(".bed-button").getBoundingClientRect().height >= 44, "Small bed target");
      const bubble = doc().querySelector('button[aria-label="Buka Unggul AI Assistant"]').getBoundingClientRect();
      assert(bubble.left >= 0 && bubble.right <= width && bubble.bottom <= frame.clientHeight && bubble.top >= 0, `Chat bubble outside ${width}`);
      if (width < 1024) {
        const nav = [...doc().querySelectorAll('nav[aria-label="Navigasi utama"]')].map(node => node.getBoundingClientRect()).find(bounds => bounds.height > 0);
        assert(nav && bubble.bottom <= nav.top, `Bubble covers visible mobile tabs at ${width}px`);
      }
      const preview = doc().querySelector(".sensor-position-preview").getBoundingClientRect(), map = doc().querySelector(".bed-viewport").firstElementChild.getBoundingClientRect();
      assert(preview.left >= map.left && preview.right <= map.right && preview.top >= map.top && preview.bottom <= map.bottom, "Corner preview outside map");
    }
    frame.width = 1440; await cancel();
  });
  await test("Integrated real 30s polling: monitoring, global pH and confirmed placement remain consistent", async () => {
    const before = await state(); const dataCount = before.requests.filter(r => r.path === "/api/sensors/126/data").length;
    await delay(31000); await wait(() => text().includes("55%") && text().includes("6.4")); const after = await state();
    assert(after.requests.filter(r => r.path === "/api/sensors/126/data").length > dataCount && marker(9, 99) && position(after).version === "8" && !text().includes("Offline"), "Polling corrupted confirmed placement/monitoring");
    assert(writes(after).length === writes(before).length, "Polling sent PUT");
  });
  await test("Integrated logout drops unsaved draft; existing session no longer authorizes editing", async () => {
    await draft(4, 44); const before = writes(await state()).length; await click('button[aria-label="Logout"]');
    await wait(() => !doc().querySelector('button[aria-label="Logout"]')); assert(!form() && !doc().querySelector(".sensor-position-preview"), "Logout retained draft");
    await click(named("Atur Posisi Sensor")); assert(doc().querySelector("#login-modal-title") && !form(), "Logout kept editor");
    assert(writes(await state()).length === before, "Logout submitted draft"); await login();
    await click(named("Atur Posisi Sensor")); assert(form().elements.namedItem("row").value === "9", "Login restored unsaved draft"); await cancel();
  });
  await test("Integrated session expiry: actual SQL lease rejects PUT 401, existing login path clears editor", async () => {
    const before = await state(); await draft(4, 44); await control("expire"); await click(named("Simpan Posisi"));
    await wait(() => doc().querySelector("#login-modal-title") && !form());
    const after = await state(); assert(!doc().querySelector('button[aria-label="Logout"]') && after.audits === before.audits && position(after).version === "8" && writes(after).at(-1).status === 401, "Expired session changed placement or auth path");
  });
  await test("Integrated application has no JavaScript errors or unhandled rejections", () => {
    errors.push(...(doc().defaultView.__e2eErrors || [])); assert(errors.length === 0, errors.join("\n"));
  });
} catch { /* Failure already includes DOM evidence; report to native runner. */ }
finally {
  const result = { outcomes, failures: outcomes.filter(o => !o.passed).length, errors };
  if (!outcomes.length) { result.failures = 1; result.outcomes.push({ name: "Application bootstrap", passed: false, error: text() || "No UI" }); }
  document.querySelector("#status").textContent = `${outcomes.filter(o => o.passed).length}/${outcomes.length} passed`;
  await fetch("/__e2e__/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
}
