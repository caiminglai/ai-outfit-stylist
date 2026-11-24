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
// ownValue 只认对象自己的键。本模块三处格式分支都拿目录名的一截去查 SOURCE_MAP，
// 目录名里出现 constructor / __proto__ 时，方括号取值会顺原型链拿到函数或 Object.prototype。
const { ownValue } = require('./common')

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
  // 文件夹里这条游戏名有人写成短横或省略号变体,统一归到规范名,否则误判成'其他'
  '崩坏-星穹铁道': '崩坏:星穹铁道',
  '崩坏：星穹铁道': '崩坏:星穹铁道',
  星穹铁道: '崩坏:星穹铁道',
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
      // 跳过目录可能在任意一层(_bak_*/zip备份/残缺模型)。顶层由调用方过滤,
      // 这里再拦嵌套的:否则某个模型文件夹内部的 zip备份/ 里的旧 .pmx 会被入库,
      // 而 /api/models/file/* 又拒发这些路径 ⇒ 展厅留下永远打不开的死卡片。
      if (shouldSkipDir(item.name)) continue
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
 * 支持三种格式:
 *   加号格式: 角色+来源[作者]   → { name: "今汐", source: "鸣潮" }
 *   旧格式:   角色_by_来源      → { name: "少女", source: "原神" }
 *   短横格式: 角色-来源[作者]   → { name: "凯茜娅", source: "尘白禁区" }
 *     (短横仅在"末段能对上已知来源"时才启用,避免把名字里带 '-' 的角色误拆)
 */

// 已知来源集合(用于短横格式的判定):SOURCE_MAP 的键 + 其规范值都是合法来源
const KNOWN_SOURCES = new Set([...Object.keys(SOURCE_MAP), ...Object.values(SOURCE_MAP)])

function normSource(s) {
  return String(s || '')
    .replace(/：/g, ':')
    .trim()
}

function parseFolderName(folderName) {
  // 加号格式: 角色+来源[作者]
  const plusIdx = folderName.indexOf('+')
  if (plusIdx >= 0) {
    const name = folderName.substring(0, plusIdx).trim()
    const rest = folderName.substring(plusIdx + 1).trim()
    // 提取游戏名: "来源[作者]" → "来源"
    const bracketIdx = rest.indexOf('[')
    const sourceRaw = bracketIdx >= 0 ? rest.substring(0, bracketIdx).trim() : rest
    // 必须只认表自己的键：SOURCE_MAP['constructor'] 顺原型链是 Object 构造器（truthy），
    // '角色+constructor' 这个目录名会让 source 变成一个函数——写库时 better-sqlite3
    // 认不了函数参数直接抛（/admin/scan 整批 500），序列化进 JSON 时这个键又整个消失。
    // '__proto__' 同理拿到 Object.prototype。10-13 实测：改前 typeof source === 'function'。
    const source = ownValue(SOURCE_MAP, normSource(sourceRaw)) || '其他'
    return { name, source }
  }

  // 旧格式: 角色_by_来源
  // 清洗口径与上面两个分支一致（剥 [作者]、全角冒号归一、去尾部数字编号）。
  // 原来这条什么都不做，`今汐_by_鸣潮[作者]` 的 sourceRaw 是 '鸣潮[作者]'，
  // 查不到就落到 '其他'——同名角色在 `+` 格式下能认出 '鸣潮'，两种写法两套结果。
  // 10-13 现量：models/ 下（递归到第 4 层，68 个目录名）`_by_` 格式 0 条，
  // 所以这次对齐只改"以后有人用旧命名建目录时"的行为，动不了展厅现有 28 条。
  const byIdx = folderName.indexOf('_by_')
  if (byIdx >= 0) {
    const name = folderName.substring(0, byIdx).trim()
    let sourceRaw = folderName.substring(byIdx + 4).trim()
    const bracketIdx = sourceRaw.indexOf('[')
    if (bracketIdx >= 0) sourceRaw = sourceRaw.substring(0, bracketIdx).trim()
    sourceRaw = sourceRaw.replace(/\d+$/, '')
    const source = ownValue(SOURCE_MAP, normSource(sourceRaw)) || '其他'
    return { name, source }
  }

  // 短横格式: 角色-来源[作者]
  // 只有当最后一个 '-' 之后(去掉尾部 [作者])能对上已知来源时才拆分,
  // 否则整体当名字(名字里本身带 '-' 的角色不受影响)。
  const dashIdx = folderName.lastIndexOf('-')
  if (dashIdx > 0) {
    const head = folderName.substring(0, dashIdx).trim()
    let tail = folderName.substring(dashIdx + 1).trim()
    const bracketIdx = tail.indexOf('[')
    if (bracketIdx >= 0) tail = tail.substring(0, bracketIdx).trim()
    // 去掉来源后的末尾数字编号(如 "原神1" → "原神")
    tail = tail.replace(/\d+$/, '')
    const key = normSource(tail)
    if (KNOWN_SOURCES.has(key) || ownValue(SOURCE_MAP, key)) {
      const source = ownValue(SOURCE_MAP, key) || key
      return { name: head, source }
    }
  }

  return { name: folderName, source: '其他' }
}

/** 扫描时需要跳过的顶层目录 */
// '残缺模型': 用户手动归集的打不开/有问题的模型文件夹,不参与入库加载
const SKIP_DIRS = new Set(['_bak_', 'zip备份', '残缺模型'])

// 隔离区一律不扫、不下发。两个工装自己造的目录都靠这条兜住:
//   quarantine-orphans.js → `models/_quarantine_隔离区`(它注释里写"以 _ 开头所以不会被 PMX 扫描")
//   prune-orphan-model-dirs.js → `models/_offlined_<日期>`(下架模型的退路)
// 判据原来只认 `_bak_` 前缀,那句注释是假的:`/admin/scan` 会把隔离区里的 .pmx 重新入库,
// 已下架的模型在展厅复活,而 `/api/models/file/*` 匿名、不限流,照样能按路径直连拖走。
// 实测盘上 28 个模型目录(顶层和任意一层)没有一个以 `_`/`.` 开头 ⇒ 放宽前缀不会误伤真模型。
function shouldSkipDir(dirName) {
  return dirName.startsWith('_') || dirName.startsWith('.') || SKIP_DIRS.has(dirName)
}

/** 相对 models/ 的路径中任一段命中跳过目录即返回 true(顶层与嵌套都拦) */
function isSkippedPath(relPath) {
  return String(relPath)
    .split(/[/\\]+/)
    .some((seg) => seg && shouldSkipDir(seg))
}

/**
 * 从 baseDir 起逐段解析 relPath，任一段精确名不存在时按大小写无关找唯一命中。
 * PMX 里声明的纹理名与目录名都可能与磁盘只差大小写（实测今汐声明 `TEX/`、`Tex/`，
 * 磁盘是 `tex/`），Windows 不分大小写所以本机看不出，Linux 下整张脸纹理全 404。
 * 任何一段零命中或多命中（磁盘上同时有 `tex` 和 `TEX`）都返回 null，不做猜测。
 * 只做同一目录内的改名匹配，不解析 `..`，越界仍由调用方 realpath 兜底。
 */
function resolvePathIgnoringCase(baseDir, relPath) {
  let current = baseDir
  for (const seg of String(relPath).split(/[/\\]+/)) {
    if (!seg || seg === '.') continue
    const candidate = path.join(current, seg)
    if (fs.existsSync(candidate)) {
      current = candidate
      continue
    }
    let entries
    try {
      entries = fs.readdirSync(current)
    } catch {
      return null // 父目录就不存在，后面无从查找
    }
    const lower = seg.toLowerCase()
    const hits = entries.filter((e) => e.toLowerCase() === lower)
    if (hits.length !== 1) return null
    current = path.join(current, hits[0])
  }
  return current
}

// 残缺模型文件夹名(供 init.js 清理记录时判断 folder 前缀用)
const BROKEN_DIR_NAME = '残缺模型'

/**
 * 一条 model_configs 记录的唯一键:`folder||file`,统一正斜杠、去尾斜杠、转小写。
 * 磁盘大小写与库里写法差一个字母是常态(Linux 分大小写),比对只看这一个形状。
 */
function pmxRowKey(folder, file) {
  const f = String(folder || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
  return f + '||' + String(file || '').toLowerCase()
}

/**
 * 请求路径是否命中"已禁用"的那条模型记录。
 * 只认 `.pmx`(以及它的 `.pmx.gz` 预压缩兄弟):纹理、物理、.sph 这些文件在库里根本没有行,
 * 匹配不上必须放行,误伤一次就是模型整张脸贴图 404。
 * 拆开写成纯函数是为了能脱离数据库单测——路由模块一 require 就会打开活库并跑启动扫描。
 *
 * @param {string} relPath 相对 models/ 的请求路径,如 `今汐+鸣潮/今汐.pmx.gz`
 * @param {Set<string>} [disabledKeys] 由 `pmxRowKey` 生成的禁用集合;省略时取进程内缓存
 * @returns {boolean}
 */
function isDisabledPmxPath(relPath, disabledKeys) {
  const keys = disabledKeys === undefined ? currentDisabledPmxKeys() : disabledKeys
  if (!keys || keys.size === 0) return false
  // 两条口传进来的形状不一样:`/api/models/file/*` 给的是 `a/b.pmx`(无首斜杠),
  // server.js 的静态口给的是 `req.path`,天然带首斜杠 `/a/b.pmx`。
  // 库里的 folder 没有首斜杠 ⇒ 不归一就永远匹配不上,禁用只堵住一条口。
  const normalized = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.gz$/i, '')
  const lower = normalized.toLowerCase()
  if (!lower.endsWith('.pmx')) return false
  const cut = lower.lastIndexOf('/')
  const folder = cut < 0 ? '' : normalized.slice(0, cut)
  const file = cut < 0 ? normalized : normalized.slice(cut + 1)
  return keys.has(pmxRowKey(folder, file))
}

// ── 进程内禁用集 ────────────────────────────────────────────────
// 模型有两条匿名下载口:`GET /api/models/file/*`(routes/models.js)与 `app.use('/models')`
// 的 express.static(server.js)。只堵前一条,后者照样把禁用模型的 .pmx 直接送出去
// (10-11 现量:门二对在售模型回 200 / 8,985,599B)。两条口共用这一份缓存才不会各说各话。
// 这里不 require db——model-utils 被 db/init 反向依赖,拿了就成循环 require;
// 所以由带库的那一侧(router)把取行数的函数注入进来,本模块只管缓存与过期。
const DISABLED_PMX_TTL_MS = 60 * 1000
let disabledPmxKeys = null
let disabledPmxBuiltAt = 0
let disabledPmxRefresher = null

/** 带库的一侧在挂载时注入:`() => [{folder, file}, ...]`(enabled=0 的那些行) */
function setDisabledPmxRefresher(fn) {
  disabledPmxRefresher = typeof fn === 'function' ? fn : null
  resetDisabledPmxCache()
}

/** 后台一改 enabled 就丢掉缓存,否则下架要等到 TTL 才生效 */
function resetDisabledPmxCache() {
  disabledPmxKeys = null
  disabledPmxBuiltAt = 0
}

function currentDisabledPmxKeys() {
  const now = Date.now()
  if (disabledPmxKeys && now - disabledPmxBuiltAt < DISABLED_PMX_TTL_MS) return disabledPmxKeys
  if (!disabledPmxRefresher) return disabledPmxKeys || new Set()
  let rows
  try {
    rows = disabledPmxRefresher()
  } catch {
    // 库一时读不到:沿用旧集,没有旧集就当作"没有禁用项"。
    // 读库失败绝不能把在售模型的贴图/主体拦掉——那是全站展厅白屏的规模。
    return disabledPmxKeys || new Set()
  }
  disabledPmxKeys = new Set((rows || []).map((r) => pmxRowKey(r.folder, r.file)))
  disabledPmxBuiltAt = now
  return disabledPmxKeys
}

module.exports = {
  SOURCE_MAP,
  ICON_MAP,
  findPmxFiles,
  parseFolderName,
  shouldSkipDir,
  isSkippedPath,
  resolvePathIgnoringCase,
  SKIP_DIRS,
  BROKEN_DIR_NAME,
  pmxRowKey,
  isDisabledPmxPath,
  setDisabledPmxRefresher,
  resetDisabledPmxCache,
  DISABLED_PMX_TTL_MS,
}
