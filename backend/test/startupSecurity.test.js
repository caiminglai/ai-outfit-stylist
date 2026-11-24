/**
 * 启动密钥门禁：生产缺失/空白密钥必须在数据库初始化前失败；
 * 开发与测试可使用带警告的默认值。子进程 cwd 是无 .env 的临时目录。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

const SERVER = path.join(__dirname, '..', 'server.js')
const PROVIDED_SECRET = 'startup-test-secret-at-least-16-chars'
const PROVIDED_PASSWORD = 'startup-test-admin-password'

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-startup-security-'))
  return {
    dir,
    dbPath: path.join(dir, 'startup.db'),
    uploadDir: path.join(dir, 'uploads'),
  }
}

function childEnv(fixture, nodeEnv) {
  const env = {
    ...process.env,
    NODE_ENV: nodeEnv,
    STYLEAI_DB_PATH: fixture.dbPath,
    STYLEAI_UPLOAD_DIR: fixture.uploadDir,
    STYLEAI_SKIP_MODEL_SCAN: '1',
    HOST: '127.0.0.1',
    PORT: '0',
  }
  delete env.SECRET_KEY
  delete env.ADMIN_PASSWORD
  return env
}

for (const [name, secret, password] of [
  ['SECRET_KEY 和 ADMIN_PASSWORD 都缺失', undefined, undefined],
  ['只缺 SECRET_KEY', undefined, PROVIDED_PASSWORD],
  ['只缺 ADMIN_PASSWORD', PROVIDED_SECRET, undefined],
  ['两个密钥都是空白', '   ', '\t'],
  [
    '使用公开示例 SECRET_KEY',
    'demo-only-replace-before-any-deployment-32-chars',
    PROVIDED_PASSWORD,
  ],
  ['使用公开示例 ADMIN_PASSWORD', PROVIDED_SECRET, 'demo-only-replace-before-any-deployment'],
  ['使用旧示例 SECRET_KEY', 'your_secret_key_at_least_16_chars', PROVIDED_PASSWORD],
  ['使用旧示例 ADMIN_PASSWORD', PROVIDED_SECRET, 'your_password_here'],
  [
    '显式使用公开开发默认 SECRET_KEY',
    'dev-only-secret-key-change-me-before-production',
    PROVIDED_PASSWORD,
  ],
  ['显式使用公开开发默认 ADMIN_PASSWORD', PROVIDED_SECRET, 'dev-only-admin-password'],
  ['使用 README 示例 SECRET_KEY', 'local-dev-only-secret-change-me-32-chars', PROVIDED_PASSWORD],
  ['使用 README 示例 ADMIN_PASSWORD', PROVIDED_SECRET, 'local-dev-only-admin-password'],
  ['使用过短的 SECRET_KEY', 'too-short-secret', PROVIDED_PASSWORD],
  ['使用过短的 ADMIN_PASSWORD', PROVIDED_SECRET, 'short'],
]) {
  test(`生产启动${name}时拒绝启动且不初始化数据库`, () => {
    const fixture = sandbox()
    try {
      const env = childEnv(fixture, 'production')
      if (secret !== undefined) env.SECRET_KEY = secret
      if (password !== undefined) env.ADMIN_PASSWORD = password
      const result = spawnSync(process.execPath, [SERVER], {
        cwd: fixture.dir,
        env,
        encoding: 'utf8',
        timeout: 3000,
        killSignal: 'SIGTERM',
      })
      assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`)
      assert.match(result.stdout + result.stderr, /SECRET_KEY|ADMIN_PASSWORD/)
      assert.equal(fs.existsSync(fixture.dbPath), false, '安全门禁必须早于数据库初始化')
      assert.equal(fs.existsSync(fixture.uploadDir), false, '安全门禁必须早于上传目录初始化')
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
}

test('生产门禁失败时不加载会写日志的 logger', () => {
  const fixture = sandbox()
  try {
    const preload = path.join(fixture.dir, 'observe-logger.cjs')
    const marker = path.join(fixture.dir, 'logger-loaded')
    const logDir = path.join(__dirname, '..', 'logs')
    fs.writeFileSync(
      preload,
      `const fs = require('node:fs');
       const original = fs.appendFileSync;
       fs.appendFileSync = function(file, ...args) {
         if (String(file).startsWith(${JSON.stringify(logDir + path.sep)})) {
           fs.writeFileSync(${JSON.stringify(marker)}, 'loaded');
         }
         return original.call(this, file, ...args);
       };`,
    )
    const result = spawnSync(process.execPath, ['-r', preload, SERVER], {
      cwd: fixture.dir,
      env: childEnv(fixture, 'production'),
      encoding: 'utf8',
      timeout: 3000,
      killSignal: 'SIGTERM',
    })
    assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`)
    assert.equal(fs.existsSync(marker), false, '密钥门禁前不应加载 logger 或写入日志')
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true })
  }
})

for (const nodeEnv of ['staging', 'prod']) {
  test(`${nodeEnv} 环境缺少密钥时拒绝启用公开默认值`, () => {
    const fixture = sandbox()
    try {
      const result = spawnSync(process.execPath, [SERVER], {
        cwd: fixture.dir,
        env: childEnv(fixture, nodeEnv),
        encoding: 'utf8',
        timeout: 3000,
        killSignal: 'SIGTERM',
      })
      assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`)
      assert.match(result.stdout + result.stderr, /SECRET_KEY|ADMIN_PASSWORD/)
      assert.equal(fs.existsSync(fixture.dbPath), false)
      assert.equal(fs.existsSync(fixture.uploadDir), false)
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
}

test('开发启动缺少密钥时使用默认值、输出警告并创建管理员', async () => {
  const fixture = sandbox()
  let child
  try {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer()
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const picked = probe.address().port
        probe.close(() => resolve(picked))
      })
    })
    const env = { ...childEnv(fixture, 'development'), PORT: String(port) }
    child = spawn(process.execPath, [SERVER], {
      cwd: fixture.dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`启动超时：${output}`)), 10000)
      const check = () => {
        if (output.includes('健康检查:')) {
          clearTimeout(timer)
          resolve()
        } else if (child.exitCode !== null) {
          clearTimeout(timer)
          reject(new Error(`提前退出 ${child.exitCode}：${output}`))
        }
      }
      child.stdout.on('data', check)
      child.stderr.on('data', check)
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error(`启动进程退出：${output}`))
      })
    })

    assert.match(output, /SECRET_KEY/)
    assert.match(output, /ADMIN_PASSWORD/)
    assert.match(output, /警告|WARN|默认/)
    const health = await fetch(`http://127.0.0.1:${port}/api/health`)
    assert.equal(health.status, 200)
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'dev-only-admin-password' }),
    })
    assert.equal(login.status, 200, '开发默认管理员密码必须能实际登录')
    const loginBody = await login.json()
    assert.ok(loginBody.data?.token, '登录必须签发可用管理员令牌')
    const db = new Database(fixture.dbPath, { readonly: true })
    try {
      const admin = db
        .prepare("SELECT password_hash FROM admin_users WHERE username = 'admin'")
        .get()
      assert.ok(admin?.password_hash, '开发默认管理员密码必须可用')
    } finally {
      db.close()
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
    }
    fs.rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('测试启动缺少密钥时同样使用默认值而不拒绝', () => {
  const fixture = sandbox()
  try {
    const env = childEnv(fixture, 'test')
    const script = `
      const fs = require('node:fs');
      const assert = require('node:assert/strict');
      const initPath = require.resolve(${JSON.stringify(path.join(__dirname, '..', 'db', 'init.js'))});
      require.cache[initPath] = {
        id: initPath, filename: initPath, loaded: true,
        exports: new Proxy({}, { get: () => () => {} }), paths: []
      };
      process.env.PORT = '0';
      require(${JSON.stringify(SERVER)});
      assert.ok(process.env.SECRET_KEY);
      assert.ok(process.env.ADMIN_PASSWORD);
      process.exit(0);
    `
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: fixture.dir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
    assert.match(result.stdout + result.stderr, /SECRET_KEY/)
    assert.match(result.stdout + result.stderr, /ADMIN_PASSWORD/)
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true })
  }
})
