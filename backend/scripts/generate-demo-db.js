#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const ROOT = path.join(__dirname, '..', '..')
const BACKEND = path.join(__dirname, '..')
const DEFAULT_OUTPUT = path.join(BACKEND, 'db', 'styleai.db')
const SCHEMA_PATH = path.join(BACKEND, 'db', 'schema.sql')
const MODEL_PATH = path.join(ROOT, 'models', 'demo', 'PortfolioBot.pmx')
const PUBLIC_TABLES = new Set([
  'inventory_categories',
  'model_configs',
  'rule_actions',
  'rule_conditions',
  'rule_groups',
])
const EXPECTED_MODEL = {
  folder: 'demo',
  file: 'PortfolioBot.pmx',
  name: 'PortfolioBot',
  source: '项目演示',
}

function usage() {
  console.log(
    '用法：node backend/scripts/generate-demo-db.cjs [--output <path>] [--replace] [--check]\n' +
      '默认输出 backend/db/styleai.db；已有文件默认拒绝覆盖。\n' +
      '--replace 只允许刷新已通过校验的脱敏演示库；--check 只校验不写入。\n' +
      '生成内容仅含项目规则、库存分类和 CC0 PortfolioBot 演示模型配置。',
  )
}

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT, check: false, replace: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') {
      options.check = true
    } else if (arg === '--replace') {
      options.replace = true
    } else if (arg === '--output') {
      const value = argv[++i]
      if (!value) throw new Error('--output 后必须提供文件路径')
      options.output = path.resolve(value)
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length)
      if (!value) throw new Error('--output 后必须提供文件路径')
      options.output = path.resolve(value)
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`不支持的参数：${arg}`)
    }
  }
  return options
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
}

function validateDatabase(db) {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
    throw new Error('SQLite 完整性检查失败')
  }
  if (db.pragma('foreign_key_check').length > 0) {
    throw new Error('SQLite 外键检查失败')
  }

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
  for (const table of tables) {
    if (!PUBLIC_TABLES.has(table) && count(db, table) !== 0) {
      throw new Error(`公开演示库包含运行时数据：${table}`)
    }
  }

  for (const table of ['rule_groups', 'rule_conditions', 'rule_actions', 'inventory_categories']) {
    if (count(db, table) === 0) throw new Error(`公开演示库缺少种子数据：${table}`)
  }
  if (count(db, 'model_configs') !== 1) {
    throw new Error('公开演示库必须且只能包含一个 PortfolioBot 模型配置')
  }

  const model = db.prepare('SELECT folder, file, name, source FROM model_configs').get()
  for (const [key, value] of Object.entries(EXPECTED_MODEL)) {
    if (model[key] !== value) throw new Error(`演示模型配置不正确：${key}`)
  }
}

function checkFile(outputPath) {
  if (!fs.existsSync(outputPath)) throw new Error(`文件不存在：${outputPath}`)
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(outputPath + suffix)) {
      throw new Error(`公开演示库不能带 SQLite 伴生文件：${outputPath + suffix}`)
    }
  }
  const db = new Database(outputPath, { readonly: true, fileMustExist: true })
  try {
    validateDatabase(db)
  } finally {
    db.close()
  }
}

function generate(outputPath, { replace = false } = {}) {
  const outputExists = fs.existsSync(outputPath)
  if (outputExists && !replace) {
    throw new Error(`拒绝覆盖：输出文件已存在：${outputPath}`)
  }
  if (outputExists) checkFile(outputPath)
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(outputPath + suffix)) {
      throw new Error(`输出路径带 SQLite 伴生文件，拒绝生成：${outputPath + suffix}`)
    }
  }
  if (!fs.existsSync(MODEL_PATH)) throw new Error(`演示模型不存在：${MODEL_PATH}`)

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.tmp-${process.pid}`
  let db
  try {
    db = new Database(tempPath)
    db.pragma('journal_mode = DELETE')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'))
    require('../db/seed').seedAll(db)
    require('../db/applyRuleSeeds').applyRuleSeeds(db)
    db.prepare(
      `INSERT INTO model_configs
        (name, icon, image_preview, description, folder, file, source, enabled, exposure, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0.3, 1)`,
    ).run(
      EXPECTED_MODEL.name,
      '',
      '',
      '项目自产 CC0 演示模型，用于本地开发和贡献者验证',
      EXPECTED_MODEL.folder,
      EXPECTED_MODEL.file,
      EXPECTED_MODEL.source,
    )
    validateDatabase(db)
    db.pragma('journal_mode = DELETE')
    db.close()
    db = null
    checkFile(tempPath)
    if (outputExists) {
      fs.copyFileSync(tempPath, outputPath)
      fs.rmSync(tempPath, { force: true })
      checkFile(outputPath)
    } else {
      fs.renameSync(tempPath, outputPath)
    }
  } catch (error) {
    if (db) db.close()
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(tempPath + suffix, { force: true })
    }
    throw error
  }
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
    if (options.help) {
      usage()
      return
    }
    if (options.check) {
      checkFile(options.output)
      console.log(`[演示库] 校验通过：${options.output}`)
      return
    }
    generate(options.output, { replace: options.replace })
    console.log(`[演示库] 已生成：${options.output}`)
  } catch (error) {
    console.error(`[演示库] ${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = { checkFile, generate, validateDatabase }
