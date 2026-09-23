'use strict'
/**
 * 重建数据库 + 更新所有模型的 name/description/source
 * 支持编号后缀(如 "少女-原神1" → role="少女", game="原神", num="1")
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const db = require('../db/init')

const DB_PATH = path.join(__dirname, '..', 'db', 'styleai.db')

// 已知游戏名
const KNOWN_GAMES = [
  '原神',
  '鸣潮',
  '尘白禁区',
  '星渊',
  '战双帕弥什',
  '崩坏3',
  '崩坏:星穹铁道',
  '星穹铁道',
  '世界计划',
  '深空之眼',
  '幻塔',
  '初音未来',
  'VOCALOID',
  'MMD',
]

function norm(s) {
  return String(s || '').replace(/:/g, ':')
}
function isKnownGame(s) {
  const ns = norm(s)
  return KNOWN_GAMES.some((g) => norm(g) === ns)
}

// 解析新格式 "角色名-游戏名编号[作者]"
// 支持末尾数字编号: "原神1" → game="原神", num="1"
function parseNewFormat(s) {
  let author = null
  let rest = s
  const am = s.match(/\[([^\]]*)\]$/)
  if (am) {
    author = am[1]
    rest = s.substring(0, s.length - am[0].length)
  }
  let role = rest
  let game = null
  let num = ''
  const lastDash = rest.lastIndexOf('-')
  if (lastDash >= 0) {
    const afterDash = rest.substring(lastDash + 1)
    // 尝试提取末尾数字编号(如 "原神1" → game="原神", num="1")
    const numMatch = afterDash.match(/^(.+?)(\d+)$/)
    let gameCandidate = afterDash
    if (numMatch) {
      gameCandidate = numMatch[1]
      num = numMatch[2]
    }
    if (isKnownGame(gameCandidate)) {
      game = gameCandidate
      role = rest.substring(0, lastDash)
    }
  }
  if (game) game = game.replace(/:/g, ':')
  return { role, game, author, num }
}

function buildNewName(t) {
  let s = t.role || '未命名'
  if (t.game) s += '-' + t.game
  if (t.num) s += t.num
  if (t.author) s += '[' + t.author + ']'
  return s
}

function buildDesc(t) {
  let s = t.game || ''
  if (t.num) s += t.num
  if (t.author) s += '[' + t.author + ']'
  return s
}

function buildSource(t) {
  return t.game || '其他'
}

;(async () => {
  // 1. 备份旧数据库
  if (fs.existsSync(DB_PATH)) {
    const backupPath = DB_PATH + '.backup-' + Date.now()
    fs.copyFileSync(DB_PATH, backupPath)
    console.log('已备份旧数据库到: ' + backupPath)
    fs.unlinkSync(DB_PATH)
    console.log('已删除旧数据库')
  }

  // 2. 重新初始化数据库 schema(db 模块本身就是 Database 实例)
  // db/init.js 在 require 时已自动执行 schema 初始化
  console.log('数据库初始化完成')

  // 3. 查询所有记录
  const rows = db
    .prepare('SELECT id, name, description, source, folder FROM model_configs ORDER BY id')
    .all()
  console.log('扫描到 ' + rows.length + ' 条记录\n')

  // 4. 更新 name/description/source
  const updStmt = db.prepare(
    "UPDATE model_configs SET name = ?, description = ?, source = ?, updated_at = datetime('now') WHERE id = ?",
  )
  let updated = 0,
    skipped = 0
  for (const row of rows) {
    const dirName = row.folder.split('/')[0]
    const t = parseNewFormat(dirName)
    const newName = buildNewName(t)
    const newDesc = buildDesc(t)
    const newSource = buildSource(t)
    if (newName !== row.name || newDesc !== row.description || newSource !== row.source) {
      updStmt.run(newName, newDesc, newSource, row.id)
      updated++
    } else {
      skipped++
    }
  }
  console.log('更新 ' + updated + ' 条, 跳过 ' + skipped + ' 条\n')

  // 5. 验证结果
  const allRows = db
    .prepare('SELECT id, name, description, source, folder, file FROM model_configs ORDER BY id')
    .all()
  console.log('=== 所有模型 (' + allRows.length + ' 个) ===')
  allRows.forEach((r) => {
    console.log(
      'id=' +
        r.id +
        '  name=' +
        r.name +
        '  desc=' +
        (r.description || '(空)') +
        '  source=' +
        r.source +
        '  folder=' +
        r.folder,
    )
  })

  // 6. 单独验证"少女"模型
  console.log('\n=== 少女模型 ===')
  const shaonvRows = db
    .prepare(
      "SELECT id, name, description, folder, file FROM model_configs WHERE folder LIKE '少女%'",
    )
    .all()
  shaonvRows.forEach((r) => console.log(JSON.stringify(r)))

  // 7. 关闭数据库(持久化)
  db.close()
  console.log('\n数据库已持久化到磁盘')
})().catch((e) => {
  console.error('致命错误:', e)
  process.exit(1)
})
