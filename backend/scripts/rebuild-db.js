'use strict'
/**
 * 重新同步所有模型的 name/icon/description/source
 *
 * 口径与 db/init.js 扫描入库时完全一致:解析统一走 utils/model-utils 的
 * parseFolderName(分隔符是 '+',不是 '-'),这样本脚本只是把已入库记录的
 * 展示字段按当前文件夹名重算一遍,绝不会用一套过期的 '-' 解析把 source 打回'其他'。
 */
require('dotenv').config()
const fs = require('fs')
const db = require('../db/init')

// 库路径只从 db/paths 取,避免各脚本各拼一份(拼错＝静默打开空库)
const { DB_PATH } = require('../db/paths')

// 解析与图标口径统一取自 model-utils,和 init.js 同源,不再本地各拼一份
const { parseFolderName, ICON_MAP } = require('../utils/model-utils')

function buildFields(folderField) {
  // folder 形如 "少女+原神/xxx" 或 "少女+原神",取顶层目录名解析
  const topDir = String(folderField || '').split(/[/\\]+/)[0]
  const { name, source } = parseFolderName(topDir)
  return {
    name,
    icon: ICON_MAP[source] || '🎭',
    description: source + ' · ' + name,
    source,
  }
}

;(async () => {
  // 1. 备份旧数据库（原来备份完还 unlinkSync(DB_PATH)：那时 db/init 的句柄已经开着，
  //    后面所有 SELECT/UPDATE 都写进那个已被删除的 inode，脚本跑完 DB_PATH 上什么都没有
  //    ⇒ 名为"重建"实为删库。本脚本对库的全部改动只有 model_configs 的 UPDATE，
  //    根本不需要删文件，所以只备份、不删除，出问题随时能用这个备份回滚。）
  if (fs.existsSync(DB_PATH)) {
    const backupPath = DB_PATH + '.backup-' + Date.now()
    fs.copyFileSync(DB_PATH, backupPath)
    console.log('已备份旧数据库到: ' + backupPath)
  } else {
    console.log('警告: ' + DB_PATH + ' 不存在,将按 schema 新建后再改模型表')
  }

  // 2. db/init.js 在 require 时已自动执行 schema 初始化
  console.log('数据库初始化完成')

  // 3. 查询所有记录
  const rows = db
    .prepare('SELECT id, name, icon, description, source, folder FROM model_configs ORDER BY id')
    .all()
  console.log('扫描到 ' + rows.length + ' 条记录\n')

  // 4. 按当前文件夹名重算展示字段(与 init.js 同口径)
  const updStmt = db.prepare(
    "UPDATE model_configs SET name = ?, icon = ?, description = ?, source = ?, updated_at = datetime('now') WHERE id = ?",
  )
  let updated = 0,
    skipped = 0
  for (const row of rows) {
    const f = buildFields(row.folder)
    // 保险:解析不出来源(回落到'其他')而库里本来有真实来源时,不动这条,
    // 避免文件夹命名不规范时把已正确的 source 打回'其他'。
    if (f.source === '其他' && row.source && row.source !== '其他') {
      skipped++
      continue
    }
    if (
      f.name !== row.name ||
      f.icon !== row.icon ||
      f.description !== row.description ||
      f.source !== row.source
    ) {
      updStmt.run(f.name, f.icon, f.description, f.source, row.id)
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
