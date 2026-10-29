// Fresh temporary native PostgreSQL only. No URL, port or data directory from env.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import assert from "node:assert/strict";

export async function createNativePlacementCluster() {
  assert.ok(process.env.UNGGUL_TEST_PG_BIN, "Set UNGGUL_TEST_PG_BIN to native PostgreSQL bin; no remote database is accepted");
  const bin = resolve(process.env.UNGGUL_TEST_PG_BIN);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("PG")));
  const run = (name, args) => promisify(execFile)(join(bin, name + (process.platform === "win32" ? ".exe" : "")), args,
    { env, windowsHide: true, timeout: 30_000 });
  const folder = await mkdtemp(join(tmpdir(), "unggul-placement-native-"));
  const root = await realpath(tmpdir());
  const actual = await realpath(folder);
  assert.ok(actual.startsWith(root + sep), "Native fixture must remain in the temporary directory");
  const data = join(folder, "data");
  const listener = createServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  let started = false;
  const connections = new Set();
  const stop = async () => {
    await Promise.allSettled([...connections].map((connection) => connection.close()));
    if (started) { await run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); started = false; }
  };
  const start = async () => {
    if (started) return;
    await run("pg_ctl", ["-D", data, "-l", join(folder, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -F -c timezone=UTC`, "-w", "start"]);
    started = true;
  };
  const close = async () => {
    await stop();
    // Keep ONLY this new fixture's logs/data for inspection. No recursive deletion.
  };
  try {
    await run("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--no-locale"]);
    await start();
  } catch (error) { await close(); throw error; }

  const connect = async () => {
    const child = spawn(process.env.UNGGUL_TEST_PYTHON || "python", [
      fileURLToPath(new URL("./nativePostgresClient.py", import.meta.url)), bin, String(port),
    ], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const pending = [];
    let stderr = "";
    let readyResolve, readyReject;
    const ready = new Promise((yes, no) => { readyResolve = yes; readyReject = no; });
    const fail = (error) => { readyReject(error); while (pending.length) pending.shift().reject(error); };
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", fail);
    child.on("exit", (code) => { if (code) fail(new Error(`Native bridge exit ${code}: ${stderr}`)); });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const result = JSON.parse(line);
      if (result.ready) return readyResolve();
      const next = pending.shift();
      if (result.error) next.reject(Object.assign(new Error(result.error), { code: result.code }));
      else next.resolve(result.rows);
    });
    const connection = {
      async exec(sql) {
        await ready;
        return new Promise((resolveQuery, reject) => {
          pending.push({ resolve: resolveQuery, reject }); child.stdin.write(JSON.stringify({ sql }) + "\n");
        });
      },
      async json(sql) { return JSON.parse((await connection.exec(sql))[0].result); },
      async close() {
        if (!connections.delete(connection)) return;
        child.stdin.end();
        await new Promise((done) => child.exitCode !== null ? done() : child.once("exit", done));
      },
    };
    connections.add(connection);
    await ready;
    const settings = await connection.json("select json_build_object('directory',current_setting('data_directory'),'host',current_setting('listen_addresses'),'database',current_database()) as result");
    assert.equal((await realpath(settings.directory)).toLowerCase(), (await realpath(data)).toLowerCase());
    assert.equal(settings.host, "127.0.0.1"); assert.equal(settings.database, "postgres");
    return connection;
  };
  return { connect, close, folder, stop, start };
}
