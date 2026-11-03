/**
 * 带隔离库跑测试（11-03 新增，起因见下）
 *
 * 背景：`package.json` 原来的 `test` 就是 `node --test "test/*.test.js"`，它不带 `STYLEAI_DB_PATH`，
 * 而 `db/paths.js` 的默认值就是 `backend/db/styleai.db` ⇒ 本机整趟跑测试开的是那份被 skip-worktree
 * 钉住的运行库（67 份测试里有 33 份 require 了 `db/init`）。实测过：整趟跑完活库 md5 会变
 * （页级 churn：WAL checkpoint 与空闲页），但那一次逐表内容与 HEAD 完全一致，没有写脏数据。
 * 隐患不在"已经坏了"，而在"再往下跑不知道哪条测试会真写库"。
 *
 * 做法：用 better-sqlite3 的 backup() 把活库整份备到系统临时目录（它是 SQLite 自己的在线备份，
 * 会把 WAL 里没落盘的内容一起带上，比直接 copy 三个文件安全），再带 `STYLEAI_DB_PATH` 指向那份副本
 * 去跑 `node --test`。副本内容与活库逐表一致 ⇒ 测试行为不变；跑完把副本连同 -wal/-shm 删掉。
 * 想要老行为（直连活库）就用 `npm run test:live`，那条命令没变。
 *
 * ⛔ 本文件不碰 `backend/db/styleai.db` 的写句柄：全程只以 readonly 打开它做备份。
 * ⚠️ 副本落在 `os.tmpdir()`（本机是 C 盘 Temp），跑完即删；中途 Ctrl+C 留下的残渣是
 *    `styleai-test-db-*` 目录，可以直接删。
 *
 * 用法：
 *   npm test                      → 隔离库跑全量
 *   npm test -- --test-name-pattern=xxx   → 其余参数原样透传给 node --test
 *   npm run test:live             → 直连活库跑全量（老行为，改库前别用）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const Database = require('better-sqlite3')

const BACKEND = path.join(__dirname, '..')
const LIVE_DB = path.join(BACKEND, 'db', 'styleai.db')
const PASS_THROUGH = process.argv.slice(2)

const cleanup = (dir, file) => {
  for (const f of [file, file + '-wal', file + '-shm']) {
    try {
      fs.rmSync(f, { force: true })
    } catch (e) {
      console.error('[测试隔离] 删副本失败：' + f + ' ⇒ ' + e.message)
    }
  }
  try {
    fs.rmdirSync(dir)
  } catch (e) {
    console.error('[测试隔离] 删临时目录失败：' + dir + ' ⇒ ' + e.message)
  }
}

const main = async () => {
  if (!fs.existsSync(LIVE_DB)) {
    console.error('[测试隔离] 找不到活库：' + LIVE_DB + '（先按 README 建库再来）')
    process.exit(1)
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-test-db-'))
  const copy = path.join(dir, 'styleai.db')
  const started = Date.now()
  const src = new Database(LIVE_DB, { readonly: true })
  try {
    const r = await src.backup(copy)
    console.error(
      '[测试隔离] 活库备份完成：' +
        r.totalPages +
        ' 页 → ' +
        copy +
        '（' +
        (Date.now() - started) +
        ' ms）',
    )
  } catch (e) {
    src.close()
    cleanup(dir, copy)
    console.error('[测试隔离] 备份失败，整趟不跑：' + e.message)
    process.exit(1)
  }
  src.close()

  const run = spawnSync(process.execPath, ['--test', 'test/*.test.js', ...PASS_THROUGH], {
    cwd: BACKEND,
    env: { ...process.env, STYLEAI_DB_PATH: copy },
    stdio: 'inherit',
  })
  cleanup(dir, copy)
  if (run.error) {
    console.error('[测试隔离] 起测试进程失败：' + run.error.message)
    process.exit(1)
  }
  console.error('[测试隔离] 副本已删；活库全程只读')
  process.exit(run.status === null ? 1 : run.status)
}

main()
