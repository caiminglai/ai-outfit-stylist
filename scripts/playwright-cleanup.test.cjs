const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const playwrightCli = path.join(
  projectRoot,
  "app",
  "node_modules",
  "playwright",
  "cli.js",
);
const playwrightTest = path.join(
  projectRoot,
  "app",
  "node_modules",
  "@playwright",
  "test",
);
const backendRequire = path.join(projectRoot, "backend", "node_modules");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const child = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0 || code === 128) resolve();
        else reject(new Error(`taskkill exited with code ${code}`));
      });
    });
  } else {
    process.kill(pid, "SIGKILL");
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function readServerPid(markerPath) {
  if (!fs.existsSync(markerPath)) return undefined;
  const pid = Number(fs.readFileSync(markerPath, "utf8"));
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function watchServerDeath(markerPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = readServerPid(markerPath);
    if (pid && !pidIsAlive(pid)) {
      return { pid, time: performance.timeOrigin + performance.now() };
    }
    await delay(5);
  }
  return { pid: readServerPid(markerPath), time: null, timedOut: true };
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`Playwright cleanup probe timed out\n${stdout}\n${stderr}`),
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function readEvents(eventLog) {
  if (!fs.existsSync(eventLog)) return [];
  return fs
    .readFileSync(eventLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function uniqueRoots(events, main) {
  return [
    ...new Set(
      events
        .filter((event) => event.type === "created" && event.main === main)
        .map((event) => event.dir),
    ),
  ];
}

function assertCleanupOrder(result) {
  const { exit, death, events, roots, mainRoots, workerRoots, signal } = result;
  const output = `${exit.stdout}\n${exit.stderr}`;
  assert.equal(signal, "SIGTERM", `probe did not emit SIGTERM\n${output}`);
  assert.ok(
    mainRoots.length === 1,
    `expected one main temporary root\n${output}`,
  );
  assert.ok(
    workerRoots.length >= 1,
    `expected a worker temporary root\n${output}`,
  );
  assert.ok(roots.length >= 2, `expected main and worker roots\n${output}`);
  assert.equal(
    pidIsAlive(death.pid),
    false,
    `WebServer survived Playwright teardown\n${output}`,
  );
  assert.ok(death.time, "WebServer death was not observed");

  for (const root of roots) {
    const removed = events.find(
      (event) => event.type === "removed" && event.dir === root,
    );
    assert.ok(
      removed,
      `temporary directory was not removed: ${root}\n${output}`,
    );
  }

  const mainRoot = mainRoots[0];
  const mainRemoved = events.find(
    (event) => event.type === "removed" && event.dir === mainRoot,
  );
  assert.ok(
    mainRemoved.time > death.time,
    `main temporary directory was removed before WebServer death\n${output}`,
  );
  assert.deepEqual(
    events.filter((event) => event.type === "remove-failed"),
    [],
    `temporary directory cleanup failed\n${output}`,
  );
}

async function withCleanupProbe(options, verify) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "styleai-cleanup-test-"),
  );
  const eventLog = path.join(fixtureRoot, "events.jsonl");
  const startedMarker = path.join(fixtureRoot, "started.txt");
  const signalMarker = path.join(fixtureRoot, "signal.txt");
  const pidMarker = path.join(fixtureRoot, "server-pid.txt");
  const probePath = path.join(fixtureRoot, "signal-probe.cjs");
  const serverPath = path.join(fixtureRoot, "server.cjs");
  const specPath = path.join(fixtureRoot, "cleanup.spec.cjs");
  const configPath = path.join(fixtureRoot, "playwright.config.cjs");
  const port = await freePort();
  let roots = [];
  let serverWatcher;

  fs.writeFileSync(
    probePath,
    `const fs = require('node:fs')
const path = require('node:path')
const eventLog = ${JSON.stringify(eventLog)}
const cli = ${JSON.stringify(playwrightCli)}
const isMain = path.resolve(process.argv[1] || '') === path.resolve(cli)
const failMain = process.env.STYLEAI_CLEANUP_FAIL_MAIN === '1'
function record(type, dir, extra = {}) {
  fs.appendFileSync(eventLog, JSON.stringify({
    type,
    dir,
    pid: process.pid,
    ppid: process.ppid,
    main: isMain,
    time: performance.timeOrigin + performance.now(),
    ...extra,
  }) + '\\n')
}
const originalMkdtemp = fs.mkdtempSync
fs.mkdtempSync = function(prefix, ...args) {
  const dir = originalMkdtemp.call(this, prefix, ...args)
  if (String(prefix).includes('styleai-playwright-')) record('created', dir)
  return dir
}
const originalRm = fs.rmSync
fs.rmSync = function(target, ...args) {
  const tracked = typeof target === 'string' && path.basename(target).startsWith('styleai-playwright-')
  if (!tracked) return originalRm.call(this, target, ...args)
  record('remove-start', target)
  try {
    if (failMain && isMain) {
      const error = new Error('simulated main cleanup failure')
      error.code = 'EPERM'
      throw error
    }
    const result = originalRm.call(this, target, ...args)
    record('removed', target)
    return result
  } catch (error) {
    record('remove-failed', target, { code: error.code })
    throw error
  }
}
let emitted = false
const timer = setInterval(() => {
  if (emitted || !fs.existsSync(${JSON.stringify(startedMarker)})) return
  emitted = true
  clearInterval(timer)
  fs.writeFileSync(${JSON.stringify(signalMarker)}, 'SIGTERM')
  process.emit('SIGTERM')
}, 25)
setTimeout(() => {
  if (emitted) return
  clearInterval(timer)
  process.exit(97)
}, 15000)
`,
  );

  fs.writeFileSync(
    serverPath,
    `const fs = require('node:fs')
const http = require('node:http')
const Database = require(${JSON.stringify(path.join(backendRequire, "better-sqlite3"))})
const db = new Database(process.env.STYLEAI_DB_PATH)
db.exec('CREATE TABLE IF NOT EXISTS cleanup_probe (id INTEGER PRIMARY KEY)')
db.prepare('INSERT INTO cleanup_probe DEFAULT VALUES').run()
const server = http.createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ status: 'ok' }))
})
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  fs.writeFileSync(${JSON.stringify(pidMarker)}, String(process.pid))
})
`,
  );

  fs.writeFileSync(
    specPath,
    `const fs = require('node:fs')
const { test } = require(${JSON.stringify(playwrightTest)})
test('cleanup signal probe', async () => {
  fs.writeFileSync(${JSON.stringify(startedMarker)}, 'started')
  await new Promise(() => {})
})
`,
  );

  fs.writeFileSync(
    configPath,
    `const base = require(${JSON.stringify(path.join(projectRoot, "playwright.config.ts"))})
module.exports = {
  ...base,
  testDir: ${JSON.stringify(fixtureRoot)},
  retries: 0,
  reporter: [...base.reporter, ['line']],
  webServer: {
    ...base.webServer,
    command: ${JSON.stringify(`${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)}`)},
  },
}
`,
  );

  try {
    const child = spawn(
      process.execPath,
      ["--require", probePath, playwrightCli, "test", "--config", configPath],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          E2E_PORT: String(port),
          CI: "",
          STYLEAI_CLEANUP_FAIL_MAIN: options.failMainCleanup ? "1" : "",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    serverWatcher = watchServerDeath(pidMarker, 50_000);
    const exit = await waitForExit(child, 45_000);
    const death = await serverWatcher;
    const events = readEvents(eventLog);
    const mainRoots = uniqueRoots(events, true);
    const workerRoots = uniqueRoots(events, false);
    roots = [...new Set([...mainRoots, ...workerRoots])];
    const signal = fs.existsSync(signalMarker)
      ? fs.readFileSync(signalMarker, "utf8")
      : undefined;
    await verify({
      exit,
      death,
      events,
      roots,
      mainRoots,
      workerRoots,
      signal,
    });
  } finally {
    const serverPid = readServerPid(pidMarker);
    if (serverPid) await stopProcess(serverPid);
    if (serverWatcher) await serverWatcher;
    if (roots.length === 0) {
      const events = readEvents(eventLog);
      roots = [
        ...new Set([
          ...uniqueRoots(events, true),
          ...uniqueRoots(events, false),
        ]),
      ];
    }
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5 });
  }
}

test(
  "SIGTERM removes every Playwright temporary root after WebServer death",
  { timeout: 90_000 },
  async () => {
    await withCleanupProbe({}, assertCleanupOrder);
  },
);

test(
  "the cleanup regression detects a main temporary root removal failure",
  { timeout: 90_000 },
  async () => {
    await withCleanupProbe({ failMainCleanup: true }, (result) => {
      assert.ok(
        result.events.some(
          (event) =>
            event.type === "remove-failed" &&
            event.main &&
            event.code === "EPERM",
        ),
        "negative control did not force a main cleanup failure",
      );
      assert.throws(
        () => assertCleanupOrder(result),
        /temporary directory cleanup failed|temporary directory was not removed/,
        "cleanup assertions did not reject the forced failure",
      );
    });
  },
);
