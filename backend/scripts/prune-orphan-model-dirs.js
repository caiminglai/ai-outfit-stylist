#!/usr/bin/env node
/**
 * 清理「库里没有记录、盘上还占着地方」的孤儿模型目录。
 *
 * 为什么需要它:展厅的模型清单来自 `model_configs` 表,后台的下架/删除会把行删掉,
 * 但 `models/` 下的目录**从来没人删**——下架动作在库里生效,盘上却继续占着镜像体积,
 * 而 `/api/models/file/*` 是按路径直发文件的(匿名、不限流),目录还在就还能被点名拖走。
 * 本机这一批下架 4 个时是我手工挪出仓外的(见 `docs/依据/10` 台账),服务器上同样的一批
 * 只能靠这个脚本做,不然每次都要人肉对目录名。
 *
 * 安全口径(和 quarantine-orphans.js 同一条红线):**只移动,不删除**。
 * 孤儿目录整份搬进 `models/_offlined_<日期>/`,该目录以 `_` 开头,
 * 扫描与下发两侧都会被 `shouldSkipDir`/`isSkippedPath` 挡掉,想恢复直接搬回去。
 *
 * 用法(容器内跑,中文目录名不过 argv):
 *   node scripts/prune-orphan-model-dirs.js --dry-run     # 默认,只列不动
 *   node scripts/prune-orphan-model-dirs.js --apply       # 实际移动
 *   node scripts/prune-orphan-model-dirs.js --print-names # 只往 stdout 打孤儿目录名,一行一个
 *      (--print-names 是给服务器用的:容器里 `/models` 是 `:ro` 挂载,mv 只能在宿主上做,
 *       名单从容器里算出来再顺着管道喂给宿主 `while read` —— 中文目录名全程不过 argv。)
 * 库路径可用 STYLEAI_DB_PATH 覆盖(对副本校验时用),目录根可用 MODELS_DIR 覆盖(沙箱校验时用)。
 */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const { DB_PATH } = require('../db/paths')
const { shouldSkipDir } = require('../utils/model-utils')

const MODELS_DIR = process.env.MODELS_DIR
  ? path.resolve(process.env.MODELS_DIR)
  : path.resolve(__dirname, '..', '..', 'models')
const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const PRINT_NAMES = args.has('--print-names')
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const OFFLINE_DIR = path.join(MODELS_DIR, `_offlined_${stamp}`)

/** 库里的 folder 可能是 `顶层目录/子层`,取第一段就是盘上的顶层目录名 */
function knownTopDirs(db) {
  const set = new Set()
  for (const row of db.prepare('SELECT folder FROM model_configs').all()) {
    if (!row.folder) continue
    const top = String(row.folder).split(/[\\/]/)[0]
    if (top) set.add(top)
  }
  return set
}

function dirBytes(p) {
  let total = 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name)
    total += e.isDirectory() ? dirBytes(full) : fs.statSync(full).size
  }
  return total
}

if (!fs.existsSync(MODELS_DIR)) {
  console.log('models 目录不存在:' + MODELS_DIR)
  process.exit(1)
}
if (!fs.existsSync(DB_PATH)) {
  console.log('库文件不存在:' + DB_PATH)
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: true })
const known = knownTopDirs(db)
const dbRows = db.prepare('SELECT COUNT(*) AS c FROM model_configs').get().c
db.close()

const topDirs = fs
  .readdirSync(MODELS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !shouldSkipDir(d.name))

const orphans = topDirs.filter((d) => !known.has(d.name))

if (PRINT_NAMES) {
  for (const d of orphans) console.log(d.name)
  process.exit(0)
}

console.log(
  `库记录 ${dbRows} 条 / 库里的顶层目录 ${known.size} 个 / 盘上顶层目录 ${topDirs.length} 个 / 孤儿 ${orphans.length} 个`,
)
console.log(`模式 ${APPLY ? 'APPLY(移动)' : 'DRY-RUN(只列,不动文件)'} | 库 ${DB_PATH}`)

if (orphans.length === 0) {
  console.log('没有孤儿目录,盘与库一致。')
  process.exit(0)
}

let moved = 0
let bytes = 0
for (const d of orphans) {
  const src = path.join(MODELS_DIR, d.name)
  let size = 0
  try {
    size = dirBytes(src)
  } catch {
    size = -1
  }
  if (!APPLY) {
    console.log(`  ORPHAN ${d.name} | ${size < 0 ? '?' : size} B (未动)`)
    continue
  }
  fs.mkdirSync(OFFLINE_DIR, { recursive: true })
  const dst = path.join(OFFLINE_DIR, d.name)
  if (fs.existsSync(dst)) {
    console.log('  SKIP 目标已存在,先人工看:' + dst)
    continue
  }
  fs.renameSync(src, dst)
  const back = fs.existsSync(src)
  if (back) {
    console.log('  FAILED 移动后原路径仍在:' + d.name)
    continue
  }
  moved++
  bytes += size
  console.log(`  MOVED ${d.name} | ${size} B → _offlined_${stamp}/`)
}

if (APPLY) {
  const left = fs
    .readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !shouldSkipDir(d.name) && !known.has(d.name))
  console.log(`APPLY 完成 | 移动 ${moved} 个 / ${bytes} B | 复验剩余孤儿 ${left.length} 个`)
} else {
  console.log('DRY-RUN 完成,没有动任何文件。要真移请加 --apply。')
}
