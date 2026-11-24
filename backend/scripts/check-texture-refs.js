/**
 * PMX 纹理引用检查工具
 * 解析指定 PMX 文件,列出其引用的所有纹理文件名
 * 用于判断乱码纹理文件是否被 PMX 引用(决定能否安全删除)
 *
 * PMX 2.0 格式参考: https://gist.github.com/felixjones/f8a06bd6809f57cd04c9
 *
 * 用法: node check-texture-refs.js <pmx文件路径>
 */
const fs = require('fs')
const path = require('path')

/**
 * 读取 PMX 文件的纹理引用列表
 * @param {string} pmxPath PMX 文件路径
 * @returns {{textures: string[], modelName: string, encoding: string}}
 */
function readPmxTextures(pmxPath) {
  const buf = fs.readFileSync(pmxPath)
  // 检查 magic
  if (buf.toString('ascii', 0, 4) !== 'PMX ') {
    throw new Error('不是 PMX 文件(magic 不匹配)')
  }
  // 版本
  const version = buf.readFloatLE(4)
  // globals_count
  let offset = 8
  const globalsCount = buf.readUInt8(offset)
  offset += 1
  // 调试: dump 前 16 字节
  if (process.env.PMX_DEBUG) {
    console.error('[DEBUG] 前 16 字节:', buf.slice(0, 16).toString('hex'))
    console.error('[DEBUG] version:', version, 'globalsCount:', globalsCount)
  }
  // 标准 PMX 2.0 globals 通常是 8 字节,按实际 globalsCount 读取
  const textEncoding = buf.readUInt8(offset)
  offset += 1
  const additionalUvCount = buf.readUInt8(offset)
  offset += 1
  const vertexIdxSize = buf.readUInt8(offset)
  offset += 1
  const textureIdxSize = buf.readUInt8(offset)
  offset += 1
  const materialIdxSize = buf.readUInt8(offset)
  offset += 1
  const boneIdxSize = buf.readUInt8(offset)
  offset += 1
  const morphIdxSize = buf.readUInt8(offset)
  offset += 1
  const rigidbodyIdxSize = buf.readUInt8(offset)
  offset += 1
  // 跳过剩余 globals(如果有)
  offset += Math.max(0, globalsCount - 8)
  if (process.env.PMX_DEBUG) {
    console.error(
      `[DEBUG] textEncoding=${textEncoding} additionalUv=${additionalUvCount} vertexIdx=${vertexIdxSize} textureIdx=${textureIdxSize} materialIdx=${materialIdxSize} boneIdx=${boneIdxSize} morphIdx=${morphIdxSize} rigidbodyIdx=${rigidbodyIdxSize}`,
    )
    console.error('[DEBUG] offset after globals:', offset)
  }

  /**
   * 读取 PMX 字符串(4 字节长度 + 内容)
   * @returns {string}
   */
  function readString() {
    const len = buf.readInt32LE(offset)
    offset += 4
    const content = buf.slice(offset, offset + len)
    offset += len
    if (textEncoding === 0) {
      return content.toString('utf16le')
    }
    return content.toString('utf8')
  }

  // 读模型名(4 个字符串:模型名、英文名、注释、英文注释)
  const modelName = readString()
  readString() // english model name
  readString() // comment
  readString() // english comment
  if (process.env.PMX_DEBUG) {
    console.error(`[DEBUG] modelName: ${modelName}`)
    console.error(`[DEBUG] offset after strings: ${offset}`)
  }

  // 顶点
  const vertexCount = buf.readUInt32LE(offset)
  offset += 4
  if (process.env.PMX_DEBUG) {
    console.error(`[DEBUG] vertexCount: ${vertexCount} offset: ${offset}`)
  }
  // 跳过所有顶点(每个顶点大小取决于权重类型,无法静态计算,需逐个解析)
  for (let i = 0; i < vertexCount; i++) {
    offset += 12 + 12 + 8 + additionalUvCount * 16 // position + normal + UV + additional UVs
    const weightType = buf.readUInt8(offset)
    offset += 1
    // 权重类型大小(参照 three.js MMDLoader)
    // BDEF1(0): 1 * bone_idx
    // BDEF2(1): 2 * bone_idx + 4 (1 float weight)
    // BDEF4(2): 4 * bone_idx + 16 (4 floats weight)
    // SDEF(3):  2 * bone_idx + 4 + 36 (1 float + C/R0/R1 三个 vec3)
    // QDEF(4):  4 * bone_idx + 16 (4 floats weight, PMX 2.1)
    if (weightType === 0) {
      offset += boneIdxSize
    } else if (weightType === 1) {
      offset += boneIdxSize * 2 + 4
    } else if (weightType === 2) {
      offset += boneIdxSize * 4 + 16
    } else if (weightType === 3) {
      offset += boneIdxSize * 2 + 40
    } else if (weightType === 4) {
      offset += boneIdxSize * 4 + 16
    } else {
      throw new Error(`未知权重类型 ${weightType},顶点 ${i}`)
    }
    offset += 4 // edge scale
  }

  // 面
  const faceCount = buf.readUInt32LE(offset)
  offset += 4
  offset += faceCount * vertexIdxSize

  // 纹理表(这就是我们要的)
  const textureCount = buf.readUInt32LE(offset)
  offset += 4
  const textures = []
  for (let i = 0; i < textureCount; i++) {
    textures.push(readString())
  }

  return {
    textures,
    modelName,
    encoding: textEncoding === 0 ? 'UTF-16LE' : 'UTF-8',
    version,
  }
}

// === 主程序 ===
const pmxPath = process.argv[2]
if (!pmxPath) {
  console.error('用法: node check-texture-refs.js <pmx文件路径>')
  process.exit(1)
}
if (!fs.existsSync(pmxPath)) {
  console.error('文件不存在:', pmxPath)
  process.exit(1)
}

const result = readPmxTextures(pmxPath)
console.log('PMX 文件:', pmxPath)
console.log('模型名:', result.modelName)
console.log('版本:', result.version, ' 编码:', result.encoding)
console.log('纹理引用数:', result.textures.length)
console.log('')
console.log('=== 纹理引用列表 ===')
result.textures.forEach((t, i) => {
  // 显示文件名 + 字节级十六进制(用于识别隐藏字符)
  const hex = Buffer.from(t, 'utf8').toString('hex')
  console.log(`[${i}] ${t}`)
  console.log(`    hex: ${hex}`)
})

// 检查纹理文件是否实际存在
console.log('')
console.log('=== 文件存在性检查 ===')
const pmxDir = path.dirname(pmxPath)
let missing = 0
let exists = 0
for (const t of result.textures) {
  // PMX 纹理路径可能是相对路径(toon/xxx.png)或绝对路径
  const texPath = path.isAbsolute(t) ? t : path.join(pmxDir, t)
  if (fs.existsSync(texPath)) {
    exists++
  } else {
    missing++
    console.log(`[缺失] ${t}`)
  }
}
console.log(`存在: ${exists}  缺失: ${missing}`)
