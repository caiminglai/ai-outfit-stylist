/**
 * dev.bat 的启动契约：只使用项目内开发数据，端口占用时退出而不杀进程。
 * Windows 专用；用 NODE_OPTIONS 探针记录环境并拦停服务进程，避免真的起服务或打开浏览器。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn, spawnSync } = require('node:child_process')

const REPO = path.join(__dirname, '..', '..')
const WINDOWS_TEST = { skip: process.platform !== 'win32' }

function makeDevSandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-dev-bat-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.copyFileSync(path.join(REPO, 'dev.bat'), path.join(root, 'dev.bat'))
  fs.mkdirSync(path.join(root, 'backend', 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(root, 'app', 'node_modules'), { recursive: true })
  // 只关掉测试沙箱里的自动开浏览器，并让后端同步退出；生产脚本仍保留独立 /k 窗口。
  const batPath = path.join(root, 'dev.bat')
  const bat = fs.readFileSync(batPath, 'utf8')
  const browserLine =
    'start "" cmd /c "timeout /t 3 /nobreak >nul 2>&1 && start http://localhost:5173"'
  assert.ok(bat.includes(browserLine), '测试夹具应能找到并禁用自动开浏览器那一行')
  const backendStart = 'start "Style AI Backend" cmd /k "'
  assert.ok(bat.includes(backendStart), '测试夹具应能找到后端窗口启动命令')
  fs.writeFileSync(
    batPath,
    bat.replace(browserLine, 'REM browser disabled by test').replace(backendStart, 'cmd /c "'),
    'utf8',
  )

  const logPath = path.join(root, 'node-calls.log')
  const probePath = path.join(root, 'node-probe.cjs')
  fs.writeFileSync(
    probePath,
    `const fs = require('node:fs')
const args = process.argv.slice(1).join(' ')
const keys = ['NODE_ENV', 'STYLEAI_DB_PATH', 'STYLEAI_UPLOAD_DIR', 'STYLEAI_LOG_DIR', 'DOTENV_CONFIG_PATH', 'SECRET_KEY', 'ADMIN_PASSWORD']
fs.appendFileSync(process.env.DEV_BAT_LOG, '===CALL=== ' + args + '\\n' + keys.map((key) => key + '=' + process.env[key]).join('\\n') + '\\n===END===\\n')
if (/server\\.js|vite\\.js/.test(args)) process.exit(0)
`,
  )
  fs.writeFileSync(
    path.join(root, '.env'),
    'SECRET_KEY=inherited-root-secret\nADMIN_PASSWORD=inherited-root-admin\n',
  )
  fs.writeFileSync(
    path.join(root, 'backend', '.env'),
    'SECRET_KEY=inherited-backend-secret\nADMIN_PASSWORD=inherited-backend-admin\n',
  )

  const env = {
    ...process.env,
    DEV_BAT_LOG: logPath,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require="${probePath.replaceAll(path.sep, '/')}"`]
      .filter(Boolean)
      .join(' '),
    NODE_ENV: 'inherited-node-env',
    STYLEAI_DB_PATH: path.join(root, 'inherited.db'),
    STYLEAI_UPLOAD_DIR: path.join(root, 'inherited-uploads'),
    STYLEAI_LOG_DIR: path.join(root, 'inherited-logs'),
    DOTENV_CONFIG_PATH: path.join(root, 'inherited.env'),
    SECRET_KEY: 'inherited-secret',
    ADMIN_PASSWORD: 'inherited-admin',
  }
  return { root, logPath, env }
}

function runDevBat(sandbox) {
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'dev.bat'], {
    cwd: sandbox.root,
    env: sandbox.env,
    encoding: 'utf8',
    input: '\r\n',
    timeout: 15000,
  })
}

async function waitForBackendCall(logPath) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes('server.js')) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail('后端启动调用没有写入探针日志')
}

function backendEnvironment(logPath) {
  const log = fs.readFileSync(logPath, 'utf8')
  const blocks = log.split('===CALL===').slice(1)
  const block = blocks.find((entry) => entry.includes('server.js'))
  assert.ok(block, '日志里应有一次真实 backend server.js 启动调用')
  return Object.fromEntries(
    block
      .split(/\r?\n/)
      .map((line) => line.split('='))
      .filter(([key, value]) => key && value !== undefined),
  )
}

async function portIsFree(port) {
  const server = http.createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    return true
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') return false
    throw error
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
}

async function startPortSentinel(t) {
  for (const port of [5000, 5173]) {
    if (!(await portIsFree(port))) t.skip(`端口 ${port} 已被现有服务占用，跳过占用保护测试`)
  }
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const http = require('node:http')
let ready = 0
for (const port of [5000, 5173]) {
  http.createServer((req, res) => res.end('alive')).listen(port, '127.0.0.1', () => {
    ready += 1
    if (ready === 2) console.log('READY')
  })
}
setInterval(() => {}, 1000)`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  t.after(() => child.kill())
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      if (chunk.toString().includes('READY')) resolve()
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`端口探针提前退出：${code}`)))
  })
  return child
}

test('dev.bat 给后端注入隔离开发环境并创建项目内目录', WINDOWS_TEST, async (t) => {
  const sandbox = makeDevSandbox(t)
  const run = runDevBat(sandbox)
  assert.equal(run.status, 0, `${run.stdout || ''}\n${run.stderr || ''}`)
  await waitForBackendCall(sandbox.logPath)
  const observed = backendEnvironment(sandbox.logPath)
  const devDir = path.join(sandbox.root, '.tmp', 'dev')
  assert.equal(observed.NODE_ENV, 'development')
  assert.equal(observed.STYLEAI_DB_PATH, path.join(devDir, 'styleai.db'))
  assert.equal(observed.STYLEAI_UPLOAD_DIR, path.join(devDir, 'uploads'))
  assert.equal(observed.STYLEAI_LOG_DIR, path.join(devDir, 'logs'))
  assert.equal(observed.DOTENV_CONFIG_PATH, path.join(devDir, 'disabled.env'))
  assert.equal(observed.SECRET_KEY, 'local-dev-only-secret-change-me-32-chars')
  assert.equal(observed.ADMIN_PASSWORD, 'local-dev-only-admin-password')
  assert.equal(fs.existsSync(path.join(devDir, 'uploads')), true)
  assert.equal(fs.existsSync(path.join(devDir, 'logs')), true)
})

test('dev.bat 遇到占用端口时退出且不终止现有进程', WINDOWS_TEST, async (t) => {
  const sentinel = await startPortSentinel(t)
  const sandbox = makeDevSandbox(t)
  const run = runDevBat(sandbox)
  const output = `${run.stdout || ''}\n${run.stderr || ''}`
  assert.notEqual(run.status, 0, output)
  assert.match(output, /5000/)
  assert.match(output, /5173/)
  assert.match(output, /占用/)
  assert.doesNotMatch(output, /终止占用/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sentinel.exitCode, null, '现有端口进程必须仍然存活')
  assert.equal(sentinel.signalCode, null, '现有端口进程不应收到信号')
})
