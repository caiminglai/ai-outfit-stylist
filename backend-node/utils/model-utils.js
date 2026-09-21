/**
 * 模型工具模块 — 共享常量与扫描逻辑
 *
 * 使用位置:
 * - db/init.js     → 服务器启动时自动扫描入库
 * - routes/models.js → 管理后台手动扫描 / 文件服务
 *
 * 消除两个文件中 SOURCE_MAP / ICON_MAP / findPmxFiles / parseFolderName 的重复定义.
 */

const fs = require('fs')
const path = require('path')

// ── 来源名称映射(文件夹后缀/作者 → 规范化来源) ──
const SOURCE_MAP = {
  原神: '原神',
  鸣潮: '鸣潮',
  尘白禁区: '尘白禁区',
  星渊: '星渊',
  小海新不恋爱: '原神',
  神帝宇: '战双帕弥什',
  微波叮桃子: '崩坏3',
  Byz轴: '世界计划',
  深空之眼: '深空之眼',
  '崩坏:星穹铁道': '崩坏:星穹铁道',
  幻塔: '幻塔',
  崩坏3: '崩坏3',
  世界计划: '世界计划',
  战双帕弥什: '战双帕弥什',
}

// ── 来源 → 图标 emoji ──
const ICON_MAP = {
  原神: '⚔️',
  鸣潮: '🌊',
  尘白禁区: '❄️',
  星渊: '⭐',
  '崩坏:星穹铁道': '🚄',
  深空之眼: '👁️',
  幻塔: '🗼',
  MMD: '🎤',
  世界计划: '🎵',
  战双帕弥什: '⚙️',
  崩坏3: '🔥',
  其他: '🎭',
}

/** 递归查找 .pmx 文件 */
function findPmxFiles(dir, relPath) {
  const results = []
  if (!fs.existsSync(dir)) return results
  const items = fs.readdirSync(dir, { withFileTypes: true })
  for (const item of items) {
    if (item.isDirectory()) {
      const childRel = relPath ? relPath + '/' + item.name : item.name
      results.push(...findPmxFiles(path.join(dir, item.name), childRel))
    } else if (item.name.toLowerCase().endsWith('.pmx')) {
      results.push({ relPath: relPath, fileName: item.name })
    }
  }
  return results
}

/**
 * 从顶层文件夹名解析模型名和来源
 *
 * 支持两种格式:
 *   新格式: 角色+来源[作者]   → { name: "今汐", source: "鸣潮" }
 *   旧格式: 角色_by_来源      → { name: "少女", source: "原神" }
 */
function parseFolderName(folderName) {
  // 新格式: 角色+来源[作者]
  const plusIdx = folderName.indexOf('+')
  if (plusIdx >= 0) {
    const name = folderName.substring(0, plusIdx).trim()
    const rest = folderName.substring(plusIdx + 1).trim()
    // 提取游戏名: "来源[作者]" → "来源"
    const bracketIdx = rest.indexOf('[')
    const sourceRaw = bracketIdx >= 0 ? rest.substring(0, bracketIdx).trim() : rest
    const source = SOURCE_MAP[sourceRaw] || '其他'
    return { name, source }
  }

  // 旧格式: 角色_by_来源
  const idx = folderName.indexOf('_by_')
  if (idx >= 0) {
    const name = folderName.substring(0, idx)
    const sourceRaw = folderName.substring(idx + 4)
    const source = SOURCE_MAP[sourceRaw] || '其他'
    return { name, source }
  }

  return { name: folderName, source: '其他' }
}

/** 扫描时需要跳过的顶层目录 */
// '残缺模型': 用户手动归集的打不开/有问题的模型文件夹,不参与入库加载
const SKIP_DIRS = new Set(['_bak_', 'zip备份', '残缺模型'])

function shouldSkipDir(dirName) {
  return dirName.startsWith('_bak_') || SKIP_DIRS.has(dirName)
}

// 残缺模型文件夹名(供 init.js 清理记录时判断 folder 前缀用)
const BROKEN_DIR_NAME = '残缺模型'

module.exports = { SOURCE_MAP, ICON_MAP, findPmxFiles, parseFolderName, shouldSkipDir, SKIP_DIRS, BROKEN_DIR_NAME }
