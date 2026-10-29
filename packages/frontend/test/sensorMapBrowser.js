const frame = document.querySelector("#app");
const results = document.querySelector("#results");
const status = document.querySelector("#status");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const doc = () => frame.contentDocument;
const text = () => doc().body.innerText;
const waitFor = async (predicate, timeout = 10_000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for UI");
    await delay(50);
  }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const click = async (selector) => {
  const button = doc().querySelector(selector);
  assert(button, `Missing ${selector}`);
  button.click();
  await delay(100);
};
const state = async (patch) => (await fetch("/__test__/state", patch ? {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
} : {})).json();
const buttonNamed = (name) => [...doc().querySelectorAll("button")].find((item) => item.textContent.trim() === name);
const editForm = () => doc().querySelector('form[aria-label="Atur Posisi Sensor"]');
const setAuth = async (isAuthenticated, secondsRemaining = 600) => {
  frame.contentWindow.dispatchEvent(new frame.contentWindow.CustomEvent("sensor-test-auth-change", { detail: { isAuthenticated, secondsRemaining } }));
  await delay(100);
};
const inputCoordinate = async (field, value) => {
  const input = editForm().elements.namedItem(field);
  const setter = Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
  await delay(50);
};
const submitPreview = async () => { editForm().requestSubmit(); await delay(50); };
let failures = 0;
const outcomes = [];
const test = async (name, action) => {
  const item = document.createElement("li");
  results.append(item);
  try { await action(); item.className = "pass"; item.textContent = `PASS — ${name}`; outcomes.push({ name, passed: true }); }
  catch (error) {
    failures++; item.className = "fail";
    const diagnostics = {
      operation: doc()?.querySelector('[data-placement-operation]')?.textContent,
      alerts: [...(doc()?.querySelectorAll('[role="alert"]') || [])].map((node) => node.textContent),
      markers: [...(doc()?.querySelectorAll('.sensor-marker') || [])].map((node) => node.getAttribute('aria-label')),
      draft: editForm()?.textContent,
    };
    const message = error.message + " " + JSON.stringify(diagnostics);
    item.textContent = `FAIL — ${name}: ${message}`; outcomes.push({ name, passed: false, error: message });
  }
};

// Reset before mounting the app: a rerun must not inherit 61% / stale from polling.
await fetch("/__test__/reset", { method: "POST" });
const errors = [];
frame.addEventListener("load", () => {
  frame.contentWindow.addEventListener("error", (event) => errors.push(event.message));
  frame.contentWindow.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
});
frame.src = "/sensor";
await waitFor(() => doc()?.querySelector(".bed-button") && !text().includes("Memuat daftar sensor"));

await test("60 bedengan berurutan; SVG berisi 1.000 titik", () => {
  const beds = [...doc().querySelectorAll(".bed-button")];
  assert(beds.length === 60 && beds.every((bed, index) => bed.textContent === `B${index + 1}`), "Urutan bedengan salah");
  assert(doc().querySelectorAll("[data-seedling]").length === 1000, "Jumlah titik bukan 1000");
  const seedlings = [...doc().querySelectorAll("[data-seedling]")];
  assert(new Set(seedlings.map((point) => point.getAttribute("cy"))).size === 10, "Jumlah baris bibit bukan 10");
  assert(new Set(seedlings.map((point) => point.getAttribute("cx"))).size === 100, "Jumlah kolom bibit bukan 100");
  assert(doc().querySelector('.bed-viewport svg').getAttribute("aria-label").includes("10 baris dan 100 kolom"), "Label koordinat belum diperbarui");
  const rows = new Set(beds.map((bed) => bed.getBoundingClientRect().top));
  assert(rows.size === 10 && beds.slice(0, 6).every((bed) => bed.getBoundingClientRect().top === beds[0].getBoundingClientRect().top), "Grid bukan 6 kolom × 10 baris");
  assert(beds.every((bed, index) => bed.getAttribute("aria-label") === `Bedengan ${index + 1}, ${index < 6 ? 1 : 0} sensor terdaftar`), "Penempatan bukan satu sensor pada B1–B6 dan kosong pada B7–B60");
  assert(!doc().querySelector('select, [role="combobox"], [role="tab"], [aria-label="Pilih lokasi bibitan"]'), "Masih ada pilihan nursery");
  assert(!/Nursery uji [AB]/i.test(text()) && text().includes("Nursery pengujian"), "Lokasi nursery salah");
});
await test("B1 hanya memuat sensor dengan identitas dan bedengan yang sesuai", async () => {
  await click('.bed-button[aria-label^="Bedengan 1,"]');
  assert(doc().querySelector('.bed-button[aria-label^="Bedengan 1,"]').getAttribute("aria-pressed") === "true", "Highlight hilang");
  const markers = [...doc().querySelectorAll(".sensor-marker")];
  assert(markers.length === 1 && markers[0].textContent === "701", "Marker salah");
});
await test("pemilihan marker menampilkan identitas dan data sebenarnya dari fixture API", async () => {
  await click('.sensor-marker[aria-label^="Sensor 701,"]');
  await waitFor(() => text().includes("55%"));
  assert(text().includes("Sensor 701") && text().includes("Online"), "Detail salah");
  assert(doc().querySelector('.sensor-marker[aria-label^="Sensor 701,"]').getAttribute("aria-pressed") === "true", "Marker tidak disorot");
  assert(!text().includes("Suhu udara (DHT11"), "Suhu kosong ditampilkan");
  assert(text().includes("pH Tanah — Pengukuran Global"), "pH tidak diberi label global");
  await click('.bed-button[aria-label^="Bedengan 2,"]');
  await click('.sensor-marker[aria-label^="Sensor 702,"]');
  await waitFor(() => doc().querySelector('section[aria-label="Informasi sensor dan pengukuran global"] h2')?.textContent === "Sensor 702" && text().includes("56%"));
  assert(!text().includes("Sensor uji 701") && !text().includes("55%"), "Identitas/data sensor lama tertinggal");
});
await test("pergantian bedengan reset sensor dan menolak respons lama", async () => {
  await state({ delay: 1400 });
  await click('.bed-button[aria-label^="Bedengan 3,"]');
  assert(!text().includes("56%"), "Detail sebelumnya tertinggal");
  await click('.bed-button[aria-label^="Bedengan 1,"]');
  await click('.sensor-marker[aria-label^="Sensor 701,"]');
  await click('.bed-button[aria-label^="Bedengan 3,"]');
  await click('.sensor-marker[aria-label^="Sensor 703,"]');
  await delay(1700);
  assert(text().includes("Sensor 703") && text().includes("57%") && !text().includes("Sensor uji 701") && !text().includes("55%"), "Respons lama mengganti identitas/data");
  await state({ delay: 0 });
});
await test("B7–B60 kosong; sensor tanpa posisi tetap dapat dipilih dari daftar", async () => {
  await click('.bed-button[aria-label^="Bedengan 60,"]');
  assert(text().includes("Belum ada sensor yang terpasang pada bedengan ini."), "Empty state hilang");
  assert(doc().querySelectorAll(".sensor-marker").length === 0, "Bedengan kosong memiliki marker");
  await click('.bed-button[aria-label^="Bedengan 6,"]');
  assert(doc().querySelectorAll(".sensor-marker").length === 0 && text().includes("Posisi belum dikonfigurasi"), "Koordinat dibuat tanpa konfigurasi");
  const button = [...doc().querySelectorAll("button")].find((item) => item.textContent.includes("Sensor uji 706"));
  button.click();
  await waitFor(() => text().includes("Sensor 706") && text().includes("60%"));
});
await test("desktop, tablet, smartphone tanpa overflow halaman; target sentuh ≥44px", async () => {
  for (const width of [1440, 768, 375, 320]) {
    frame.width = width;
    await delay(200);
    assert(doc().documentElement.scrollWidth <= width, `Overflow pada ${width}px: ${doc().documentElement.scrollWidth}`);
    assert(doc().querySelector(".bed-button").getBoundingClientRect().height >= 44, "Target bedengan terlalu kecil");
    const panels = [...doc().querySelectorAll('section[aria-label]')].filter((element) => /Detail bedengan|Informasi sensor dan/.test(element.getAttribute("aria-label")));
    const [left, right] = panels.map((element) => element.getBoundingClientRect());
    assert(width === 1440 ? Math.abs(left.top - right.top) < 2 : right.top > left.top, `Susunan panel salah pada ${width}px`);
  }
  frame.width = 1440;
  await click('.bed-button[aria-label^="Bedengan 1,"]');
  assert(doc().querySelector(".sensor-marker").getBoundingClientRect().width >= 44, "Target marker terlalu kecil");
});
await test("zoom, Fit View dan fokus keyboard tersedia", async () => {
  const viewport = doc().querySelector(".bed-viewport");
  const canvas = viewport.firstElementChild;
  await click('button[aria-label="Perbesar bedengan"]');
  assert(canvas.style.width === "150%", "Zoom gagal");
  [...doc().querySelectorAll("button")].find((item) => item.textContent.trim() === "Fit View").click(); await delay(100);
  assert(canvas.style.width === "100%", "Fit View gagal");
  const marker = doc().querySelector(".sensor-marker"); marker.focus();
  assert(doc().activeElement === marker && marker.tagName === "BUTTON", "Marker tidak dapat difokuskan");
});
await test("empat sudut 10 × 100 berada di dalam peta dan mengikuti titik SVG di semua ukuran dan zoom", async () => {
  const corners = [[1, 1], [1, 100], [10, 1], [10, 100]];
  for (const width of [1440, 768, 375, 320]) {
    frame.width = width;
    await delay(100);
    for (let index = 0; index < corners.length; index++) {
      await click(`.bed-button[aria-label^="Bedengan ${index + 1},"]`);
      const [row, column] = corners[index];
      const viewport = doc().querySelector(".bed-viewport");
      const canvas = viewport.firstElementChild;
      for (const zoom of [1, 1.5, 2, 2.5, 3]) {
        if (zoom > 1) await click('button[aria-label="Perbesar bedengan"]');
        const marker = doc().querySelector(".sensor-marker");
        assert(marker.getAttribute("aria-label") === `Sensor ${701 + index}, baris ${row}, kolom ${column}`, "Koordinat marker salah");
        const bounds = canvas.getBoundingClientRect();
        const target = marker.getBoundingClientRect();
        assert(target.left >= bounds.left && target.right <= bounds.right && target.top >= bounds.top && target.bottom <= bounds.bottom, `Marker keluar peta pada ${width}px, zoom ${zoom}`);
        const point = doc().querySelectorAll("[data-seedling]")[(row - 1) * 100 + column - 1].getBoundingClientRect();
        assert(Math.abs((target.left + target.right - point.left - point.right) / 2) < 1 && Math.abs((target.top + target.bottom - point.top - point.bottom) / 2) < 1, "Marker bergeser dari titik SVG");
      }
      assert(doc().querySelector('button[aria-label="Perbesar bedengan"]').disabled, "Zoom maksimum tidak disabled");
      if (width === 320) {
        assert(viewport.scrollWidth > viewport.clientWidth, "Zoom tidak menyediakan scroll horizontal");
        viewport.scrollLeft = viewport.scrollWidth;
        viewport.scrollTop = viewport.scrollHeight;
        assert(viewport.scrollLeft > 0, "Scroll horizontal tidak berfungsi");
      }
      [...doc().querySelectorAll("button")].find((item) => item.textContent.trim() === "Fit View").click();
      await delay(50);
      assert(canvas.style.width === "100%" && viewport.scrollLeft === 0 && viewport.scrollTop === 0, "Fit View tidak mereset zoom/scroll");
      assert(doc().querySelector('button[aria-label="Perkecil bedengan"]').disabled, "Zoom minimum tidak disabled");
    }
  }
  frame.width = 1440;
});
await test("posisi lama di luar batas tidak digambar tetapi sensor tetap dapat dipilih", async () => {
  await click('.bed-button[aria-label^="Bedengan 5,"]');
  assert(doc().querySelectorAll(".sensor-marker").length === 0, "Posisi lama dikonversi menjadi marker");
  const button = [...doc().querySelectorAll("button")].find((item) => item.textContent.includes("Sensor uji 705"));
  assert(button?.textContent.includes("Posisi belum dikonfigurasi"), "Sensor invalid hilang dari daftar");
  button.click();
  await waitFor(() => text().includes("Sensor 705") && text().includes("59%"));
});
await test("kegagalan API tidak menjadi nilai dummy atau status Offline palsu", async () => {
  await state({ detailError: true });
  await click('.bed-button[aria-label^="Bedengan 2,"]');
  await click('.sensor-marker[aria-label^="Sensor 702,"]');
  await waitFor(() => text().includes("Data sensor gagal dimuat"));
  assert(!/55%|56%|0%|Offline/.test(text()), "Error diperlakukan sebagai pembacaan");
  await state({ detailError: false });
  await click('.bed-button[aria-label^="Bedengan 1,"]');
  await click('.sensor-marker[aria-label^="Sensor 701,"]');
  await waitFor(() => text().includes("55%"));
});
await test("polling 30 detik memperbarui nilai, status dan timestamp tanpa mengganti ID", async () => {
  await setAuth(true);
  buttonNamed("Atur Posisi Sensor").click();
  await delay(100);
  await inputCoordinate("row", "3");
  await inputCoordinate("column", "4");
  const before = await state();
  assert(text().includes("55%") && text().includes("Online"), "Polling tidak dimulai dari state awal");
  const timestamp = "2026-10-27T01:23:45.000Z";
  await state({ moisture: 61, health: "stale", measuredAt: timestamp });
  status.textContent = "Menunggu satu siklus polling asli 30 detik…";
  await waitFor(() => text().includes("61%") && text().includes("Stale"), 35_000);
  assert(text().includes("09.23.45 WITA") || text().includes("09:23:45 WITA"), "Timestamp salah");
  assert(doc().querySelector('.sensor-marker[aria-pressed="true"]').textContent === "701", "Identitas berubah");
  const after = await state();
  assert(after.calls["/api/sensors/701/data"] === before.calls["/api/sensors/701/data"] + 1, "Polling harus melakukan tepat satu request detail baru");
  assert(editForm()?.elements.namedItem("row").value === "3" && doc().querySelector(".sensor-position-preview"), "Polling menghapus draft lokal");
  assert(after.writes.length === 0, "Pratinjau menulis data API");
  buttonNamed("Batal").click();
  await setAuth(false);
});
await test("metadata lokasi/bedengan belum lengkap tetap dapat dibaca tanpa marker tebakan", async () => {
  await state({ missingLocation: true, invalidBed: true, moisture: 55, health: "online" });
  frame.src = "/sensor?metadata-incomplete=1";
  await waitFor(() => text().includes("Sensor di luar peta (2)"));
  const summary = [...doc().querySelectorAll("summary")].find((item) => item.textContent.includes("Sensor di luar peta"));
  summary.click();
  const button = [...doc().querySelectorAll("button")].find((item) => item.textContent === "Sensor uji 706");
  button.click();
  await waitFor(() => text().includes("Sensor 706") && text().includes("60%"));
  assert(text().includes("Lokasi belum tercatat") && doc().querySelectorAll(".sensor-marker").length === 0, "Lokasi/marker ditebak");
  [...doc().querySelectorAll("button")].find((item) => item.textContent === "Sensor uji 705").click();
  await waitFor(() => text().includes("Sensor 705") && text().includes("59%"));
  assert(text().includes("Belum terpetakan (B1–B60)"), "Nomor bedengan ditebak");
});
await test("izin operator dan sensor terdaftar diperlukan untuk memulai pengeditan", async () => {
  await fetch("/__test__/reset", { method: "POST" });
  await state({ extraSensor: true });
  frame.src = "/sensor?position-editor=1";
  await waitFor(() => doc()?.location.search.includes("position-editor") && doc()?.querySelector(".bed-button") && !text().includes("Memuat daftar sensor"));
  assert(buttonNamed("Atur Posisi Sensor").disabled, "Tamu dapat memulai editor");
  await click('.sensor-marker[aria-label^="Sensor 701,"]');
  assert(!buttonNamed("Atur Posisi Sensor").disabled, "Tamu tidak dapat membuka login existing");
  buttonNamed("Atur Posisi Sensor").click();
  await delay(50);
  assert(doc().querySelector('#login-modal-title')?.textContent.trim() === "Login", "Modal login existing tidak terbuka");
  doc().querySelector("[data-seedling]").dispatchEvent(new frame.contentWindow.MouseEvent("click", { bubbles: true }));
  assert(!editForm() && !doc().querySelector(".sensor-position-preview"), "Tamu dapat mengedit melalui titik");
  buttonNamed("Batal").click(); await delay(50);
  assert(!doc().querySelector('#login-modal-title') && !editForm(), "Batal login membuka editor");
  await setAuth(true, 0);
  assert(buttonNamed("Atur Posisi Sensor").disabled, "Sesi kedaluwarsa dapat mengedit");
  await setAuth(true);
  assert(!buttonNamed("Atur Posisi Sensor").disabled, "Operator aktif tidak dapat mengedit sensor terdaftar");
  await click('.bed-button[aria-label^="Bedengan 60,"]');
  assert(buttonNamed("Atur Posisi Sensor").disabled, "Bedengan kosong dapat diedit");
});
await test("sensor tanpa posisi dapat ditempatkan; kosong ditolak dan stepper berhenti pada batas", async () => {
  await click('.bed-button[aria-label^="Bedengan 6,"]');
  [...doc().querySelectorAll("button")].find((item) => item.textContent.includes("Sensor uji 706")).click();
  await delay(100);
  buttonNamed("Atur Posisi Sensor").click();
  await delay(100);
  assert(editForm()?.textContent.includes("ID 706") && editForm().textContent.includes("Belum dikonfigurasi"), "Identitas atau posisi lama salah");
  assert(editForm().elements.namedItem("row").value === "" && !doc().querySelector(".sensor-position-preview"), "Posisi pertama ditebak");
  await submitPreview();
  assert(editForm().querySelectorAll('[role="alert"]').length === 2 && !doc().querySelector(".sensor-position-preview"), "Input kosong diterima");
  for (const [field, label, maximum] of [["row", "baris", 10], ["column", "kolom", 100]]) {
    await click(`button[aria-label="Tambah ${label}"]`);
    assert(editForm().elements.namedItem(field).value === "1", "Stepper kosong tidak dimulai dari 1");
    assert(doc().querySelector(`button[aria-label="Kurangi ${label}"]`).disabled, "Minus minimum tidak disabled");
    await click(`button[aria-label="Kurangi ${label}"]`);
    assert(editForm().elements.namedItem(field).value === "1", "Minus melewati minimum");
    await inputCoordinate(field, String(maximum - 1));
    await click(`button[aria-label="Tambah ${label}"]`);
    assert(editForm().elements.namedItem(field).value === String(maximum) && doc().querySelector(`button[aria-label="Tambah ${label}"]`).disabled, "Plus maksimum tidak disabled");
    await click(`button[aria-label="Tambah ${label}"]`);
    assert(editForm().elements.namedItem(field).value === String(maximum), "Plus melewati maksimum");
    await click(`button[aria-label="Kurangi ${label}"]`);
    assert(!doc().querySelector(`button[aria-label="Tambah ${label}"]`).disabled, "Stepper tidak aktif kembali");
    await inputCoordinate(field, "1");
  }
  buttonNamed("Batal").click();
  await delay(50);
  assert(!editForm() && !doc().querySelector(".sensor-position-preview") && !doc().querySelector('.sensor-marker[aria-label^="Sensor 706,"]'), "Batal membuat posisi sensor tanpa koordinat");
});
await test("input manual invalid ditolak; titik dan form memperbarui pratinjau yang sama", async () => {
  await click('.bed-button[aria-label^="Bedengan 1,"]');
  await click('.sensor-marker[aria-label^="Sensor 701,"]');
  buttonNamed("Atur Posisi Sensor").click();
  await delay(50);
  assert(editForm().elements.namedItem("row").value === "1" && editForm().elements.namedItem("column").value === "1", "Posisi lama tidak dimuat");
  for (const [field, maximum] of [["row", 10], ["column", 100]]) {
    for (const value of ["0", "-1", String(maximum + 1), "1.5", "1.0", "1e0", "abc", "1x", "", " "]) {
      await inputCoordinate(field, value);
      await submitPreview();
      assert(editForm().elements.namedItem(field).getAttribute("aria-invalid") === "true" && editForm().querySelector('[role="alert"]'), `Input ${field}=${value} diterima`);
      assert(!doc().querySelector(".sensor-position-preview") && !editForm().querySelector('[role="status"]'), "Draft invalid menghasilkan pratinjau valid");
      await inputCoordinate(field, "1");
    }
  }
  const point = doc().querySelectorAll("[data-seedling]")[999];
  point.dispatchEvent(new frame.contentWindow.MouseEvent("click", { bubbles: true }));
  await delay(50);
  assert(editForm().elements.namedItem("row").value === "10" && editForm().elements.namedItem("column").value === "100", "Pemilihan titik tidak memperbarui form");
  for (const width of [1440, 375, 320]) {
    frame.width = width;
    await delay(100);
    await inputCoordinate("row", "10");
    await inputCoordinate("column", "100");
    const preview = doc().querySelector(".sensor-position-preview");
    assert(preview.getAttribute("aria-label").includes("baris 10, kolom 100"), "Form tidak memperbarui marker");
    const bounds = doc().querySelector(".bed-viewport").firstElementChild.getBoundingClientRect();
    const target = preview.getBoundingClientRect();
    assert(target.left >= bounds.left && target.right <= bounds.right && target.top >= bounds.top && target.bottom <= bounds.bottom, "Pratinjau keluar peta");
    assert(doc().documentElement.scrollWidth <= width, "Editor menyebabkan overflow halaman");
    await click('button[aria-label="Perbesar bedengan"]');
    buttonNamed("Fit View").click();
    await delay(50);
    assert(editForm().elements.namedItem("column").value === "100", "Zoom/Fit View menghapus draft");
  }
  frame.width = 1440;
  await submitPreview();
  assert(editForm().querySelector('[role="status"]')?.textContent.includes("belum disimpan permanen"), "Konfirmasi memberi kesan tersimpan");
  assert(buttonNamed("Simpan Posisi")?.disabled, "Mode JSON mengaktifkan penyimpanan");
  buttonNamed("Simpan Posisi").click();
  assert((await state()).writes.length === 0, "Mode JSON mengirim PUT");
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 701, baris 1, kolom 1"]'), "Posisi asli berubah saat pratinjau");
  buttonNamed("Batal").click();
  await delay(50);
  assert(!editForm() && !doc().querySelector(".sensor-position-preview") && doc().querySelector('.sensor-marker[aria-label="Sensor 701, baris 1, kolom 1"]'), "Batal tidak mengembalikan posisi lama");
  point.dispatchEvent(new frame.contentWindow.MouseEvent("click", { bubbles: true }));
  assert(!editForm(), "Titik memulai edit di luar mode edit");
});
await test("draft dibuang pada perpindahan sensor/bedengan dan pencabutan izin", async () => {
  await click('.bed-button[aria-label^="Bedengan 6,"]');
  const chooseSensor = async (id) => { [...doc().querySelectorAll("button")].find((item) => item.textContent.includes(`Sensor uji ${id}`)).click(); await delay(50); };
  await chooseSensor(706);
  buttonNamed("Atur Posisi Sensor").click(); await delay(50);
  await inputCoordinate("row", "7"); await inputCoordinate("column", "88");
  await chooseSensor(707);
  assert(!editForm() && !doc().querySelector(".sensor-position-preview"), "Draft dibawa ke sensor lain");
  buttonNamed("Atur Posisi Sensor").click(); await delay(50);
  assert(editForm().elements.namedItem("row").value === "2" && editForm().elements.namedItem("column").value === "3", "Draft menggantikan posisi sensor lain");
  await chooseSensor(706);
  buttonNamed("Atur Posisi Sensor").click(); await delay(50);
  assert(editForm().elements.namedItem("row").value === "", "Draft lama muncul kembali setelah kembali ke sensor");
  await inputCoordinate("row", "9"); await inputCoordinate("column", "99");
  await click('.bed-button[aria-label^="Bedengan 1,"]');
  assert(!editForm() && !doc().querySelector(".sensor-position-preview"), "Draft dibawa ke bedengan lain");
  await click('.sensor-marker[aria-label^="Sensor 701,"]');
  buttonNamed("Atur Posisi Sensor").click(); await delay(50);
  await inputCoordinate("row", "8");
  await setAuth(false);
  assert(!editForm() && !doc().querySelector(".sensor-position-preview"), "Logout tidak membuang draft");
  buttonNamed("Atur Posisi Sensor").click(); await delay(50);
  assert(doc().querySelector('#login-modal-title') && !editForm(), "Logout tidak menutup akses edit atau membuka login existing");
  buttonNamed("Batal").click(); await delay(50);
  await setAuth(true);
  buttonNamed("Atur Posisi Sensor").click(); await delay(50);
  assert(editForm().elements.namedItem("row").value === "1", "Draft tanpa izin muncul kembali");
  await setAuth(true, 0);
  assert(!editForm() && buttonNamed("Atur Posisi Sensor").disabled, "Draft tetap aktif setelah sesi kedaluwarsa");
  const finalState = await state();
  assert(finalState.writes.length === 0, "Pengeditan lokal mengirim request tulis API");
  assert(finalState.calls["/api/sensors/701/data"] > 0 && text().includes("pH Tanah — Pengukuran Global"), "Monitoring existing tidak tersedia");
});
const chooseSensor = async (bed, id) => {
  await click(`.bed-button[aria-label^="Bedengan ${bed},"]`);
  const sensor = [...doc().querySelectorAll("button")].find((item) => item.textContent.includes(`Sensor uji ${id}`));
  sensor.click(); await delay(100);
};
const draft = async (row, column) => {
  if (!editForm()) { buttonNamed("Atur Posisi Sensor").click(); await delay(100); }
  await inputCoordinate("row", String(row)); await inputCoordinate("column", String(column)); await submitPreview();
};
const operation = (name) => doc().querySelector(`[data-placement-operation="${name}"]`);
await test("mode database tetap memakai login existing sebelum editor atau PUT tersedia", async () => {
  await fetch("/__test__/reset", { method: "POST" });
  await state({ placementMode: "db", extraSensor: true });
  frame.src = "/sensor?save-position=1";
  await waitFor(() => doc()?.location.search.includes("save-position") && !text().includes("Memuat daftar sensor") && doc()?.querySelector(".bed-button"));
  await chooseSensor(6, 706);
  buttonNamed("Atur Posisi Sensor").click(); await delay(100);
  assert(doc().querySelector("#login-modal-title") && !editForm() && !buttonNamed("Simpan Posisi"), "Tamu mendapat akses simpan");
  assert((await state()).writes.length === 0, "Tamu mengirim PUT");
  buttonNamed("Batal").click(); await setAuth(true);
});
await test("penempatan pertama memvalidasi input, menunggu konfirmasi server, mengunci klik ganda dan refresh GET langsung", async () => {
  await draft(0, 75);
  assert(buttonNamed("Simpan Posisi").disabled, "Input invalid dapat disimpan");
  assert((await state()).writes.length === 0, "Input invalid terkirim");
  await inputCoordinate("row", "5");
  assert(buttonNamed("Simpan Posisi").disabled, "Perubahan belum ditinjau dapat disimpan");
  await submitPreview();
  const before = await state(); await state({ writeDelay: 300 });
  const save = buttonNamed("Simpan Posisi"); save.click(); save.click(); await delay(100);
  assert(buttonNamed("Menyimpan…")?.disabled && editForm().elements.namedItem("row").disabled, "Simpan tidak terkunci");
  assert(!operation("success"), "Sukses muncul sebelum respons server");
  await waitFor(() => operation("success") && doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 5, kolom 75"]'));
  const after = await state(), write = after.writes.at(-1);
  assert(after.writes.length === 1 && write.authorized, "Klik ganda atau kredensial existing tidak benar");
  assert(write.payload.expectedVersion === null && write.payload.expectedContext.location === "Nursery pengujian" && write.payload.expectedContext.bedengan === 6, "Payload penempatan pertama salah");
  assert(after.calls["/api/sensors"] > before.calls["/api/sensors"], "GET tidak segera diperbarui");
  assert(doc().querySelector('.sensor-marker[aria-label^="Sensor 706,"]').getAttribute("aria-pressed") === "true", "Pemilihan sensor hilang");
  await state({ writeDelay: 0 });
});
await test("refresh simulasi mempertahankan posisi; update memakai version string dan hasil server terbaru", async () => {
  frame.src = "/sensor?save-refresh=1";
  await waitFor(() => doc()?.location.search.includes("save-refresh") && doc()?.querySelector(".bed-button") && !text().includes("Memuat daftar sensor"));
  await chooseSensor(6, 706); await setAuth(true);
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 5, kolom 75"]'), "Posisi hilang setelah refresh");
  await draft(6, 76);
  assert(text().includes("Versi posisi: 1"), "Versi database belum digunakan");
  buttonNamed("Simpan Posisi").click();
  await waitFor(() => operation("success") && doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 6, kolom 76"]'));
  const snapshot = await state();
  assert(snapshot.writes.at(-1).payload.expectedVersion === "1" && snapshot.placements["706"].version === "2", "Versi tidak bertambah sesuai server");
});
await test("GET yang tertinggal tidak menimpa marker/version hasil commit dan menutup simpan sampai pembacaan siap", async () => {
  await state({ registryStale: true }); await draft(7, 77);
  const before = (await state()).writes.length;
  buttonNamed("Simpan Posisi").click(); await waitFor(() => operation("needs_read"));
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 7, kolom 77"]'), "GET lama menimpa marker terbaru");
  assert(!operation("success") && buttonNamed("Periksa Posisi"), "Pembacaan tertinggal dianggap siap");
  await state({ registryStale: false }); buttonNamed("Periksa Posisi").click(); await waitFor(() => operation("success"));
  assert((await state()).writes.length === before + 1, "Rekonsiliasi mengulang PUT");
});
await test("409 mempertahankan posisi existing, membaca ulang dan meminta tinjauan baru", async () => {
  await state({ saveStatus: 409, saveCode: "PLACEMENT_VERSION_CONFLICT" }); await draft(8, 80);
  buttonNamed("Simpan Posisi").click(); await waitFor(() => operation("error"));
  assert(text().includes("Versi posisi telah berubah") && !operation("success"), "Konflik tidak ditampilkan dengan benar");
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 7, kolom 77"]'), "409 menimpa posisi existing");
  assert(buttonNamed("Simpan Posisi").disabled, "409 langsung mengulang simpan tanpa tinjauan");
});
await test("400, 403, 404 dan 503 tidak memberi sukses palsu atau mengubah kesehatan sensor", async () => {
  for (const [saveStatus, saveCode, expected] of [[400, "INVALID_PLACEMENT", "payload ditolak"],
    [403, "PLACEMENT_ACCESS_DENIED", "Akses penyimpanan ditolak"], [404, "SENSOR_NOT_FOUND", "Sensor tidak ditemukan"],
    [503, "SENSOR_PLACEMENT_WRITE_DISABLED", "belum diaktifkan"], [503, "SENSOR_PLACEMENT_READ_NOT_READY", "database belum siap"]]) {
    await state({ saveStatus, saveCode }); await submitPreview();
    buttonNamed("Simpan Posisi").click(); await waitFor(() => operation("error")?.textContent.includes(expected));
    assert(!operation("success") && !doc().querySelector("#login-modal-title"), `HTTP ${saveStatus} memberi sukses/logout palsu`);
    assert(doc().querySelector('button[aria-label="Logout"]'), "403/503 menghapus sesi");
    assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 7, kolom 77"]'), "Error menimpa marker");
    assert(text().includes("Online"), "Error simpan mengganti kesehatan sensor");
  }
});
await test("401 membuka login existing dan membuang draft tanpa mengulang write setelah login", async () => {
  await state({ saveStatus: 401, saveCode: "SESSION_TIMEOUT" }); await submitPreview();
  buttonNamed("Simpan Posisi").click();
  await waitFor(() => doc().querySelector("#login-modal-title") && !editForm());
  const before = (await state()).writes.length;
  buttonNamed("Batal").click(); await state({ saveStatus: 200, saveCode: "" }); await setAuth(true);
  assert(!editForm(), "Draft expired muncul kembali");
  await delay(100); assert((await state()).writes.length === before, "Login mengulang PUT lama");
});
await test("timeout sesudah commit membaca ulang, menampilkan ketidakpastian, dan tidak mengulang PUT", async () => {
  await state({ writeDelay: 11_000 }); await draft(9, 90);
  const before = (await state()).writes.length;
  buttonNamed("Simpan Posisi").click();
  await waitFor(() => operation("warning"), 15_000);
  assert(operation("warning").textContent.includes("belum pasti") && !operation("success"), "Timeout dianggap pasti sukses/gagal");
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 9, kolom 90"]'), "Commit timeout tidak dibaca ulang");
  assert((await state()).writes.length === before + 1, "Timeout memicu retry PUT otomatis");
  assert(buttonNamed("Simpan Posisi").disabled && buttonNamed("Muat Posisi Terbaru"), "Versi baru tidak meminta tinjauan draft ulang");
  buttonNamed("Batal").click(); await state({ writeDelay: 0 });
});
await test("hasil belum pasti dengan GET gagal menutup retry sampai Periksa Posisi berhasil", async () => {
  await state({ malformedSave: true, registryError: true }); await draft(1, 85);
  const before = (await state()).writes.length;
  buttonNamed("Simpan Posisi").click(); await waitFor(() => operation("needs_read") && buttonNamed("Periksa Posisi"));
  assert(!operation("success") && !editForm(), "Respons rusak atau refresh gagal dianggap sukses");
  await state({ malformedSave: false, registryError: false }); buttonNamed("Periksa Posisi").click();
  await waitFor(() => operation("warning") && doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 1, kolom 85"]'));
  assert((await state()).writes.length === before + 1, "Periksa Posisi mengirim PUT");
});
await test("respons simpan terlambat tidak memilih sensor lama atau memulihkan draft setelah pindah/logout", async () => {
  await state({ writeDelay: 700 }); await draft(2, 86); buttonNamed("Simpan Posisi").click();
  await chooseSensor(1, 701); await delay(800);
  assert(doc().querySelector('.sensor-marker[aria-label^="Sensor 701,"]').getAttribute("aria-pressed") === "true" && !editForm(), "Respons lama mengubah selection/draft");
  await chooseSensor(6, 706); await draft(3, 87); buttonNamed("Simpan Posisi").click(); await setAuth(false); await delay(800);
  assert(!editForm() && !doc().querySelector(".sensor-position-preview"), "Respons lama memulihkan editor sesudah logout");
  await setAuth(true); await state({ writeDelay: 0 });
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 3, kolom 87"]'), "Hasil server terkonfirmasi tidak memperbarui marker");
});
await test("status invalid, context_mismatch dan unavailable menampilkan peringatan dan hanya mengizinkan pratinjau", async () => {
  const before = (await state()).writes.length;
  for (const status of ["invalid", "context_mismatch", "unavailable"]) {
    await state({ placementStates: { "701": status } }); frame.src = `/sensor?placement-status=${status}`;
    await waitFor(() => doc()?.location.search.includes(status) && doc()?.querySelector(".bed-button") && !text().includes("Memuat daftar sensor"));
    await setAuth(true); await chooseSensor(1, 701); await draft(4, 40);
    assert(buttonNamed("Simpan Posisi").disabled && doc().querySelector('[role="alert"]'), `${status} mengizinkan PUT atau tanpa peringatan`);
    buttonNamed("Simpan Posisi").click(); assert((await state()).writes.length === before, "Status invalid mengirim PUT");
  }
  await state({ placementStates: {} }); frame.src = "/sensor?confirmed-poll=1";
  await waitFor(() => doc()?.location.search.includes("confirmed-poll") && doc()?.querySelector(".bed-button") && !text().includes("Memuat daftar sensor"));
  await setAuth(true); await chooseSensor(6, 706);
});
await test("polling monitoring/pH setelah simpan mempertahankan marker dan tidak mengirim write tambahan", async () => {
  const before = await state(); await state({ moisture: 61, health: "stale", measuredAt: "2026-10-29T01:23:45.000Z" });
  await waitFor(() => text().includes("66%") && text().includes("Stale"), 35_000);
  assert(doc().querySelector('.sensor-marker[aria-label="Sensor 706, baris 3, kolom 87"]'), "Polling menimpa marker hasil simpan");
  assert((await state()).writes.length === before.writes.length, "Polling mengirim PUT");
  assert(text().includes("pH Tanah — Pengukuran Global"), "pH global tidak tersedia");
});
await test("tidak ada error JavaScript atau unhandled rejection", () => assert(errors.length === 0, errors.join("; ")));
status.textContent = failures ? `SELESAI: ${failures} pengujian gagal.` : `SELESAI: ${outcomes.length}/${outcomes.length} pengujian browser lulus.`;
document.title = failures ? "FAIL — Sensor Map Browser Tests" : "PASS — Sensor Map Browser Tests";
await fetch("/__test__/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ failures, outcomes }) });
