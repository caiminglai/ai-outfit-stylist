const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = __dirname;
const browsersPath = path.join(
  projectRoot,
  "app",
  ".tmp",
  "playwright-browsers",
);
process.env.PLAYWRIGHT_BROWSERS_PATH ||= browsersPath;

// Execute the dependency installed under app/, not a root or global Playwright.
const { defineConfig } = require("./app/node_modules/@playwright/test");

const e2eTempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "styleai-playwright-"),
);
const uploadDir = path.join(e2eTempRoot, "uploads");
const logDir = path.join(e2eTempRoot, "logs");
fs.mkdirSync(uploadDir);
fs.mkdirSync(logDir);
const dbPath = path.join(e2eTempRoot, "styleai.db");
const port = Number(process.env.E2E_PORT || 5189);
const baseURL = `http://127.0.0.1:${port}`;
const backendEntry = path
  .join(projectRoot, "backend", "server.js")
  .replaceAll(path.sep, "/");
const dbEntry = path
  .join(projectRoot, "backend", "db", "init.js")
  .replaceAll(path.sep, "/");
const executable = JSON.stringify(process.execPath);
const initDatabase = `${executable} -e ${JSON.stringify(
  `const db=require(${JSON.stringify(dbEntry)});db.stopWalCheckpointTimer();db.close()`,
)}`;
const seedDemoModel = `${executable} -e ${JSON.stringify(
  `const db=require(${JSON.stringify(dbEntry)});` +
    `const existing=db.prepare('SELECT id FROM model_configs WHERE folder = ? AND file = ?').get('demo','PortfolioBot.pmx');` +
    `if(!existing)db.prepare('INSERT INTO model_configs (name, icon, description, folder, file, source, enabled, exposure, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, 0.3, 1)').run('PortfolioBot','CC0 Demo','仓库自带 CC0 演示模型','demo','PortfolioBot.pmx','CC0 Demo');` +
    `db.stopWalCheckpointTimer();db.close()`,
)}`;

module.exports = defineConfig({
  testDir: path.join(projectRoot, "app", "e2e"),
  outputDir: path.join(projectRoot, ".tmp", "playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: path.join(projectRoot, ".tmp", "playwright-report"),
        open: "never",
      },
    ],
  ],
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    // The temporary cwd has no .env, so dotenv cannot read local credentials.
    command: `${initDatabase} && ${seedDemoModel} && ${executable} ${JSON.stringify(backendEntry)}`,
    cwd: e2eTempRoot,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      SECRET_KEY: "playwright-test-only-secret-key-at-least-32-chars",
      ADMIN_PASSWORD: "playwright-test-only-admin-password",
      STYLEAI_DB_PATH: dbPath,
      STYLEAI_UPLOAD_DIR: uploadDir,
      STYLEAI_LOG_DIR: logDir,
      STYLEAI_SKIP_MODEL_SCAN: "1",
      STYLEAI_TEST_INIT: "1",
      CORS_ORIGINS: baseURL,
      DASHSCOPE_API_KEY: "",
      LLM_API_BASE: "",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      TRYON_API_URL: "",
      TRYON_API_KEY: "",
      TRYON_MODEL: "",
      WXPAY_MCHID: "",
      WXPAY_SERIAL_NO: "",
      WXPAY_APIV3_KEY: "",
      WXPAY_PUBLIC_KEY_ID: "",
      WXPAY_PRIVATE_KEY_PATH: "",
      WXPAY_PUBLIC_KEY_PATH: "",
      WXPAY_NOTIFY_URL: "",
      WXPAY_APPID: "",
      ALIPAY_APP_ID: "",
      ALIPAY_PRIVATE_KEY_PATH: "",
      ALIPAY_PUBLIC_KEY_PATH: "",
      ALIPAY_NOTIFY_URL: "",
      ALIPAY_RETURN_URL: "",
      ALIPAY_SELLER_ID: "",
    },
  },
});

// Playwright owns SIGINT cancellation. SIGTERM must enter the same asynchronous
// path so worker and WebServer teardown finish before the process exits.
process.once("SIGTERM", () => {
  process.emit("SIGINT");
});

// The exit event runs after Playwright teardown. Each process that loads this
// config owns its own temporary root, including worker processes.
process.once("exit", () => {
  if (!path.basename(e2eTempRoot).startsWith("styleai-playwright-")) return;
  try {
    fs.rmSync(e2eTempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (error) {
    console.error("Failed to remove Playwright temporary directory:", error);
  }
});
