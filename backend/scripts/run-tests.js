/**
 * 用系统临时目录里的独立 SQLite 库跑测试。
 *
 * 运行库 backend/db/styleai.db 不是测试夹具：这里从 schema.sql、db/seed/*.json
 * 和测试专用管理员凭据重建空库，再把 STYLEAI_DB_PATH 传给 node --test。
 * 本机 models/ 资产也不参与测试库，避免不同检出的模型文件改变测试数据。
 *
 * 用法：
 *   npm test
 *   npm test -- --test-name-pattern=xxx
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const BACKEND = path.join(__dirname, '..')
const PASS_THROUGH = process.argv.slice(2)
const TEST_ADMIN_PASSWORD = 'test-only-admin-password'
const TEST_SECRET_KEY = 'test-only-secret-key-at-least-16-chars'

const cleanup = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  } catch (e) {
    console.error('[测试隔离] 删临时目录失败：' + dir + ' ⇒ ' + e.message)
    return false
  }
}

const main = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-test-db-'))
  const dbPath = path.join(dir, 'styleai.db')
  const uploadDir = path.join(dir, 'uploads')
  const logDir = path.join(dir, 'logs')
  fs.mkdirSync(uploadDir)
  fs.mkdirSync(logDir)
  // 只继承运行 Node/测试所需的操作系统变量，不把本机 .env 或真实 AI/支付凭据带进子进程。
  const inheritedKeys = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'HOME',
    'USERPROFILE',
    'TEMP',
    'TMP',
    'TMPDIR',
    'NODE_PATH',
    'NODE_OPTIONS',
    'CI',
    'STYLEAI_COMPOSE_YML',
    'TEST_DB_OBSERVED_PATH',
  ])
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (inheritedKeys.has(key.toUpperCase())) env[key] = value
  }
  Object.assign(env, {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    DOTENV_CONFIG_PATH: path.join(dir, 'disabled.env'),
    STYLEAI_DB_PATH: dbPath,
    STYLEAI_UPLOAD_DIR: uploadDir,
    STYLEAI_LOG_DIR: logDir,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    SECRET_KEY: TEST_SECRET_KEY,
    STYLEAI_SKIP_MODEL_SCAN: '1',
    STYLEAI_TEST_INIT: '1',
  })
  for (const key of [
    'DASHSCOPE_API_KEY',
    'LLM_API_BASE',
    'LLM_API_KEY',
    'LLM_MODEL',
    'TRYON_API_URL',
    'TRYON_API_KEY',
    'TRYON_MODEL',
    'WXPAY_MCHID',
    'WXPAY_SERIAL_NO',
    'WXPAY_APIV3_KEY',
    'WXPAY_PUBLIC_KEY_ID',
    'WXPAY_PRIVATE_KEY_PATH',
    'WXPAY_PUBLIC_KEY_PATH',
    'WXPAY_NOTIFY_URL',
    'WXPAY_APPID',
    'ALIPAY_APP_ID',
    'ALIPAY_PRIVATE_KEY_PATH',
    'ALIPAY_PUBLIC_KEY_PATH',
    'ALIPAY_NOTIFY_URL',
    'ALIPAY_RETURN_URL',
    'ALIPAY_SELLER_ID',
  ]) {
    env[key] = ''
  }

  // 初始化放在独立子进程：db/init 会启动定时器，不能留在运行器里长期持有已关闭的库。
  const init = spawnSync(
    process.execPath,
    ['-e', "const db = require('./db/init'); db.stopWalCheckpointTimer(); db.close()"],
    { cwd: BACKEND, env, stdio: 'inherit' },
  )
  if (init.error || init.status !== 0) {
    cleanup(dir)
    console.error('[测试隔离] 临时库初始化失败' + (init.error ? '：' + init.error.message : ''))
    process.exit(1)
  }

  console.error('[测试隔离] 临时库已从 schema 与种子生成：' + dbPath)
  const run = spawnSync(process.execPath, ['--test', 'test/*.test.js', ...PASS_THROUGH], {
    cwd: BACKEND,
    env,
    stdio: 'inherit',
  })
  const cleaned = cleanup(dir)

  if (run.error) {
    console.error('[测试隔离] 起测试进程失败：' + run.error.message)
    process.exit(1)
  }
  if (!cleaned) process.exit(1)
  console.error(
    '[测试隔离] 临时库及 -wal/-shm、临时上传/日志目录已删除；未读取运行库、backend/uploads 或 backend/logs',
  )
  process.exit(run.status === null ? 1 : run.status)
}

main()
