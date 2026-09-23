/**
 * 乱码孤儿文件隔离工具(安全版,不删除只移动)
 *
 * 背景:fix-mojibake.js 能识别"未被任何 PMX 引用的乱码文件",
 *      但其 --delete-orphans 选项是直接 fs.unlinkSync 永久删除,
 *      违反"不永久删除用户文件"的安全红线.
 *
 * 本脚本:扫描 models 目录的乱码孤儿文件,移动到隔离目录,
 *        保留可恢复性.隔离目录本身不会被 PMX 扫描(以 _ 开头).
 *
 * 用法:
 *   node scripts/quarantine-orphans.js --dry-run    # 预览
 *   node scripts/quarantine-orphans.js --apply       # 实际移动
 */
const fs = require('fs')
const path = require('path')

const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models')
const QUARANTINE_DIR = path.join(MODELS_DIR, '_quarantine_隔离区')

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run') || !args.has('--apply')

/**
 * 判断文件名是否为乱码
 * 检测:U+FFFD(替换字符) + 私用区字符(U+E000-U+F8FF)
 */
function isMojibake(name) {
  for (const ch of name) {
    const code = ch.codePointAt(0)
    if (code === 0xfffd) return true
    if (code >= 0xe000 && code <= 0xf8ff) return true
  }
  return false
}

/**
 * 读取 PMX 文件的纹理引用列表(与 fix-mojibake.js 同逻辑)
 */
function readPmxTextures(pmxPath) {
  const buf = fs.readFileSync(pmxPath)
  if (buf.toString('ascii', 0, 4) !== 'PMX ') {
    throw new Error('不是 PMX 文件: ' + pmxPath)
  }
  let offset = 8
  const globalsCount = buf.readUInt8(offset)
  offset += 1
  const textEncoding = buf.readUInt8(offset)
  offset += 1
  const additionalUvCount = buf.readUInt8(offset)
  offset += 1
  const vertexIdxSize = buf.readUInt8(offset)
  offset += 1
  offset += 1 // textureIdxSize
  offset += 1 // materialIdxSize
  const boneIdxSize = buf.readUInt8(offset)
  offset += 1
  offset += 1 // morphIdxSize
  offset += 1 // rigidbodyIdxSize
  offset += Math.max(0, globalsCount - 8)

  function readString() {
    const len = buf.readInt32LE(offset)
    offset += 4
    const content = buf.slice(offset, offset + len)
    offset += len
    return textEncoding === 0 ? content.toString('utf16le') : content.toString('utf8')
  }

  readString() // model name
  readString() // english model name
  readString() // comment
  readString() // english comment

  const vertexCount = buf.readUInt32LE(offset)
  offset += 4
  for (let i = 0; i < vertexCount; i++) {
    offset += 12 + 12 + 8 + additionalUvCount * 16
    const weightType = buf.readUInt8(offset)
    offset += 1
    if (weightType === 0) offset += boneIdxSize
    else if (weightType === 1) offset += boneIdxSize * 2 + 4
    else if (weightType === 2) offset += boneIdxSize * 4 + 16
    else if (weightType === 3) offset += boneIdxSize * 2 + 40
    else if (weightType === 4) offset += boneIdxSize * 4 + 16
    else throw new Error(`未知权重类型 ${weightType}`)
    offset += 4
  }

  const faceCount = buf.readUInt32LE(offset)
  offset += 4
  offset += faceCount * vertexIdxSize

  const textureCount = buf.readUInt32LE(offset)
  offset += 4
  const textures = []
  for (let i = 0; i < textureCount; i++) {
    textures.push(readString())
  }
  return textures
}

// === 主流程 ===
console.log(`模式: ${DRY_RUN ? 'DRY-RUN(预览)' : 'APPLY(实际移动)'}`)
console.log(`隔离目录: ${QUARANTINE_DIR}`)
console.log('')

// 1. 收集所有 PMX 引用的纹理名
const allReferencedTextures = new Set()
const pmxFiles = []
function scanPmx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 跳过隔离目录和 zip 备份,避免重复扫描
    if (entry.name === '_quarantine_隔离区' || entry.name === 'zip备份' || entry.name.startsWith('.')) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanPmx(full)
    } else if (entry.name.toLowerCase().endsWith('.pmx')) {
      pmxFiles.push(full)
    }
  }
}
scanPmx(MODELS_DIR)
console.log(`扫描到 ${pmxFiles.length} 个 PMX 文件`)

for (const pmx of pmxFiles) {
  try {
    const textures = readPmxTextures(pmx)
    for (const tex of textures) {
      allReferencedTextures.add(path.basename(tex))
    }
  } catch (e) {
    console.warn(`[跳过] 解析失败: ${pmx} - ${e.message}`)
  }
}
console.log(`PMX 引用的纹理名总数: ${allReferencedTextures.size}`)

// 2. 扫描乱码孤儿文件(乱码 + 未被任何 PMX 引用)
const orphans = []
function scanOrphans(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_quarantine_隔离区' || entry.name === 'zip备份' || entry.name.startsWith('.')) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanOrphans(full)
    } else if (isMojibake(entry.name) && !allReferencedTextures.has(entry.name)) {
      orphans.push(full)
    }
  }
}
scanOrphans(MODELS_DIR)

console.log('')
console.log('=== 待隔离的乱码孤儿文件 ===')
if (orphans.length === 0) {
  console.log('(无)')
}

if (!DRY_RUN && orphans.length > 0) {
  // 创建隔离目录(保留原子目录结构便于追溯)
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true })
}

const movedLog = []
for (const o of orphans) {
  const rel = path.relative(MODELS_DIR, o)
  const size = fs.statSync(o).size
  console.log(`  ${rel} (${size} bytes)`)

  if (!DRY_RUN) {
    // 在隔离目录下保留原子目录结构,避免重名冲突
    const subDir = path.dirname(rel)
    const destDir = path.join(QUARANTINE_DIR, subDir)
    fs.mkdirSync(destDir, { recursive: true })

    // 文件名保留乱码原样(加 .orphan 后缀避免歧义)
    const baseName = path.basename(o)
    const destPath = path.join(destDir, baseName + '.orphan')

    try {
      fs.renameSync(o, destPath)
      movedLog.push({ from: rel, to: path.relative(MODELS_DIR, destPath), size })
      console.log(`    [OK] 已移动到隔离区`)
    } catch (e) {
      console.log(`    [FAIL] ${e.message}`)
    }
  }
}

// 3. 输出隔离清单(便于后续人工确认/恢复)
if (!DRY_RUN && movedLog.length > 0) {
  const manifestPath = path.join(QUARANTINE_DIR, '_manifest.json')
  const manifest = {
   隔离时间: new Date().toISOString(),
    说明: '这些文件是乱码孤儿(文件名含 U+FFFD/私用区字符,且未被任何 PMX 引用).确认无用后可手动删除整个隔离目录.',
    文件列表: movedLog,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log('')
  console.log(`隔离清单已写入: ${manifestPath}`)
}

console.log('')
console.log('=== 汇总 ===')
console.log(`待隔离文件: ${orphans.length} 个`)
if (DRY_RUN) {
  console.log('(DRY-RUN 模式,未实际移动.加 --apply 执行移动)')
} else {
  console.log(`已移动: ${movedLog.length} 个`)
  console.log('如需恢复,查看隔离目录下的 _manifest.json')
}
