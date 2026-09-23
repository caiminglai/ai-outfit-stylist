// 诊断脚本:检查数据库模型配置是否存在重复、冲突、异常叠加
const db = require('../db/init')
const fs = require('fs')
const path = require('path')

const MODELS_DIR = path.join(__dirname, '..', '..', 'models')

console.log('=== 数据库模型配置诊断 ===\n')

// 1. 检查是否有重复的 folder+file 组合
const duplicates = db.prepare(`
  SELECT folder, file, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
  FROM model_configs
  GROUP BY folder, file
  HAVING cnt > 1
`).all()
console.log('1. 重复的 folder+file 组合:')
if (duplicates.length === 0) {
  console.log('  无重复 ✓')
} else {
  duplicates.forEach((d) => console.log(`  ⚠ ${d.folder}/${d.file} — ${d.cnt} 条记录 (IDs: ${d.ids})`))
}

// 2. 检查是否有同一文件夹下多个 .pmx 文件可能导致混淆
console.log('\n2. 每个模型文件夹下的 .pmx 文件数:')
const allEnabled = db.prepare('SELECT id, name, folder, file, enabled FROM model_configs ORDER BY id').all()
const folderMap = {}
for (const m of allEnabled) {
  if (!folderMap[m.folder]) folderMap[m.folder] = []
  folderMap[m.folder].push(m)
}

for (const [folder, records] of Object.entries(folderMap)) {
  const pmxCount = records.filter((r) => r.file.endsWith('.pmx')).length
  if (pmxCount > 1) {
    console.log(`  ⚠ ${folder}: ${pmxCount} 个 PMX 文件`)
    records.forEach((r) => {
      const pmxExists = fs.existsSync(path.join(MODELS_DIR, r.folder, r.file))
      console.log(`    #${r.id} ${r.name} — ${r.file} — ${pmxExists ? '存在' : '缺失'}`)
    })
  }
}
if (Object.keys(folderMap).every((f) => folderMap[f].filter((r) => r.file.endsWith('.pmx')).length <= 1)) {
  console.log('  每个文件夹只有 1 个 .pmx 文件 ✓')
}

// 3. 检查 .pmx 文件内部是否有多个 mesh 节点(用文件大小粗略判断)
console.log('\n3. 启用模型列表及文件大小:')
const enabled = db.prepare('SELECT id, name, folder, file, exposure, scale, enabled FROM model_configs WHERE enabled = 1 ORDER BY id').all()
for (const m of enabled) {
  const pmxPath = path.join(MODELS_DIR, m.folder, m.file)
  let sizeKB = 0
  if (fs.existsSync(pmxPath)) {
    // 读取 PMX 文件头(前几字节可判断版本),然后读取 MESH 记录数
    try {
      const buf = fs.readFileSync(pmxPath)
      // PMX 格式:头部 30 字节 + 1 字节版本 + 4 字节 magic
      // 然后有模型参数,包含 mesh 数
      // 简化:通过搜索特定字符判断模型复杂度
      const meshCount = (buf.toString('binary').match(/MESH/g) || []).length
      const bytes = buf.length
      console.log(`  #${m.id} ${m.name.padEnd(15)} ${(bytes/1024).toFixed(1).padStart(8)} KB | 包含 ${meshCount} 个 MESH 标记 | folder: ${m.folder}`)
    } catch (e) {
      console.log(`  #${m.id} ${m.name} — 读取失败: ${e.message}`)
    }
  } else {
    console.log(`  #${m.id} ${m.name} — 文件缺失!`)
  }
}

// 4. 检查是否有异常的 scale 值(scale 为 0 或负数)
console.log('\n4. 异常 scale/exposure 值:')
const anormalous = enabled.filter((m) => m.scale <= 0 || m.exposure <= 0)
if (anormalous.length === 0) {
  console.log('  无异常 ✓')
} else {
  anormalous.forEach((m) => console.log(`  ⚠ #${m.id} ${m.name} — scale=${m.scale}, exposure=${m.exposure}`))
}

// 5. 重点检查:有没有两个启用模型指向不同 folder 但共享文件系统路径
console.log('\n5. 检查文件夹嵌套关系(可能导致前端路径错误):')
const folderPaths = enabled.map((m) => ({
  id: m.id,
  name: m.name,
  folder: m.folder,
  file: m.file,
  fullPath: path.join(MODELS_DIR, m.folder, m.file)
}))

// 检查 fullPath 是否重复
const pathMap = {}
for (const fp of folderPaths) {
  const key = fp.fullPath.toLowerCase()
  if (!pathMap[key]) pathMap[key] = []
  pathMap[key].push(fp)
}
const dupPaths = Object.values(pathMap).filter((v) => v.length > 1)
if (dupPaths.length === 0) {
  console.log('  无重复路径 ✓')
} else {
  dupPaths.forEach((group) => {
    console.log(`  ⚠ 多个模型指向同一文件:`)
    group.forEach((g) => console.log(`    #${g.id} ${g.name} → ${g.folder}/${g.file}`))
  })
}
