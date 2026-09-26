/**
 * 纹理文件扁平化 — 将旧嵌套目录中的纹理/材质移到顶层根目录
 * 确保 PMX 能从当前根位置找到所有纹理引用
 */
const fs = require('fs')
const path = require('path')
const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models')

// 需要处理的文件夹及其旧嵌套目录
const fixes = [
  {
    folder: '安卡希雅+战双帕弥什[神帝宇]',
    oldDir: '安卡希雅-时之重奏/安卡希雅-时之重奏未',
  },
  {
    folder: '尤诺+鸣潮',
    oldDir: '尤诺',
  },
  {
    folder: '月下誓约德丽莎+崩坏3[微波叮桃子]',
    oldDir: '月下誓约-此生永携',
  },
  {
    folder: '瓦吉特+深空之眼[蒙德究史尼]',
    oldDir: '瓦吉特清凉版_MDJSN_edit_v1.0_模之屋配布用',
  },
  {
    folder: '阮梅+崩坏-星穹铁道[蒙德究史尼]',
    oldDir: '阮梅素体_MDJSN_edit_v1.1_模之屋配布用',
  },
  {
    folder: '芬妮+尘白禁区[神帝宇]',
    oldDir: '芬妮-澄意 夕晖蜜约',
  },
  {
    folder: '琴+原神',
    oldDir: '嬚',
  },
]

// 检查安卡希雅+尘白禁区
const ankaxiDirs = [
  '安卡希雅+尘白禁区[神帝宇]/安卡希雅-时之重奏 缘音回响/安卡希雅-时之重奏 缘音回响',
  '安卡希雅+尘白禁区[神帝宇]/安卡希雅-时之重奏 缘音回响/安卡希雅-时之重奏 缘音回响 成长后',
]

console.log('========================================')
console.log('  纹理扁平化 — 移动旧嵌套目录内容到根')
console.log('========================================\n')

let totalMoved = 0
let totalDeleted = 0

// 处理安卡希雅(尘白) — 两个旧目录
for (const oldRel of ankaxiDirs) {
  const oldPath = path.join(MODELS_DIR, oldRel)
  const rootPath = path.join(MODELS_DIR, '安卡希雅+尘白禁区[神帝宇]')

  if (!fs.existsSync(oldPath)) {
    console.log('⏭️  目录不存在(已处理): ' + oldRel)
    continue
  }

  const entries = fs.readdirSync(oldPath, { withFileTypes: true })
  if (entries.length === 0) {
    console.log('📭 空目录: ' + oldRel)
    continue
  }

  console.log('📁 处理: ' + oldRel + ' (' + entries.length + ' 项)')
  for (const entry of entries) {
    const src = path.join(oldPath, entry.name)
    const dst = path.join(rootPath, entry.name)
    if (!fs.existsSync(dst)) {
      fs.renameSync(src, dst)
      console.log('  → ' + entry.name)
      totalMoved++
    } else {
      console.log('  ⚠️  冲突跳过: ' + entry.name)
    }
  }
}

// 处理其余文件夹
for (const fix of fixes) {
  const oldPath = path.join(MODELS_DIR, fix.folder, fix.oldDir)

  if (!fs.existsSync(oldPath)) {
    console.log('⏭️  目录不存在: ' + fix.folder + '/' + fix.oldDir)
    continue
  }

  const rootPath = path.join(MODELS_DIR, fix.folder)

  // 递归移动所有内容
  function moveContents(srcDir, dstDir, prefix) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name)
      const dst = path.join(dstDir, entry.name)

      if (entry.isDirectory()) {
        if (!fs.existsSync(dst)) {
          fs.mkdirSync(dst, { recursive: true })
        }
        moveContents(src, dst, prefix + '  ')
      } else {
        if (!fs.existsSync(dst)) {
          fs.renameSync(src, dst)
          console.log(prefix + '→ ' + entry.name)
          totalMoved++
        } else {
          console.log(prefix + '⚠️ 冲突跳过: ' + entry.name)
        }
      }
    }
  }

  console.log('📁 处理: ' + fix.folder + '/' + fix.oldDir)
  moveContents(oldPath, rootPath, '  ')
}

console.log('\n移动文件数: ' + totalMoved)

// 清理空目录
console.log('\n=== 清理空目录 ===')

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name)
      removeEmptyDirs(sub)
      // After cleaning subdirectories, check if this directory is now empty
      try {
        const remaining = fs.readdirSync(sub)
        if (remaining.length === 0) {
          fs.rmdirSync(sub)
          console.log('  🗑️  ' + path.relative(MODELS_DIR, sub))
          totalDeleted++
        }
      } catch (_) {}
    }
  }
}

for (const fix of fixes) {
  const oldPath = path.join(MODELS_DIR, fix.folder, fix.oldDir)
  if (fs.existsSync(oldPath)) {
    removeEmptyDirs(oldPath)
  }
}

// 清理安卡希雅的
removeEmptyDirs(path.join(MODELS_DIR, '安卡希雅+尘白禁区[神帝宇]/安卡希雅-时之重奏 缘音回响'))
removeEmptyDirs(path.join(MODELS_DIR, '安卡希雅+战双帕弥什[神帝宇]/安卡希雅-时之重奏'))

// 删除顶层旧目录
const toRemove = [
  ...ankaxiDirs.map((d) => path.join(MODELS_DIR, d)),
  ...fixes.map((f) => path.join(MODELS_DIR, f.folder, f.oldDir)),
]
toRemove.forEach((d) => {
  if (fs.existsSync(d)) {
    try {
      fs.rmdirSync(d)
      console.log('  🗑️  ' + path.relative(MODELS_DIR, d))
      totalDeleted++
    } catch (e) {
      console.log('  ⚠️  ' + path.relative(MODELS_DIR, d) + ' (非空)')
    }
  }
})

console.log('\n删除目录数: ' + totalDeleted)
console.log('✅ 完成!')
