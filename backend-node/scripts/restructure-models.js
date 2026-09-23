/**
 * 模型文件结构扁平化 + 统一命名 + 数据库全量更新
 *
 * 目标:
 * 1. 每个 DB 记录的 PMX 文件直接放在对应顶层文件夹根目录(无可嵌套子目录)
 * 2. PMX 统一命名:{角色}_{版本}.pmx
 * 3. 所有纹理/材质子目录(material/sph/tex/textures)保持与PMX同级的相对位置
 * 4. 世界计划4个角色拆分为独立顶层文件夹
 * 5. DB folder/file 字段全量更新
 */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models')
const db = new Database(path.join(__dirname, '..', 'db', 'styleai.db'))

// Debug: verify paths
console.log('MODELS_DIR:', MODELS_DIR)
console.log('DB_PATH:', path.join(__dirname, '..', 'db', 'styleai.db'))
console.log('今汐 test:', path.join(MODELS_DIR, '今汐+鸣潮', '今汐.pmx'))
console.log('exists:', require('fs').existsSync(path.join(MODELS_DIR, '今汐+鸣潮', '今汐.pmx')))
console.log('')

// ======================== 数据结构 ========================
// 每项: { id, oldFolder, oldFile, newFolder, newFile, moves: [{from, to}] }
// moves 中 from/to 都是相对于 MODELS_DIR 的路径
const plan = []

// ======================== Group 1: 简单改名 ========================
function simpleRename(id, oldFile, newFile) {
  const rec = db.prepare('SELECT folder FROM model_configs WHERE id=?').get(id)
  plan.push({ id, oldDir: rec.folder, oldFile, newDir: rec.folder, newFile, moves: [] })
}

// 6-今汐: 鸣潮_今汐_桃夭灼灼1.0311.pmx → 今汐.pmx
simpleRename(6, '鸣潮_今汐_桃夭灼灼1.0311.pmx', '今汐.pmx')

// 23-哥伦比娅: 少女.pmx → 哥伦比娅.pmx
simpleRename(23, '少女.pmx', '哥伦比娅.pmx')

// 18-守岸人: 守岸人-鸣潮1.pmx → 守岸人.pmx
simpleRename(18, '守岸人-鸣潮1.pmx', '守岸人.pmx')

// 29-散华: 散华1.0.pmx → 散华.pmx
simpleRename(29, '散华1.0.pmx', '散华.pmx')

// 60-昔涟: 星穹铁道—昔涟5.pmx → 昔涟.pmx
simpleRename(60, '星穹铁道—昔涟5.pmx', '昔涟.pmx')

// 50-雷电将军·BOSS: Raiden Boss_v1.1.pmx → 雷电将军_BOSS.pmx
simpleRename(50, 'Raiden Boss_v1.1.pmx', '雷电将军_BOSS.pmx')

// 51-里芙: 无限之视-爱意凝晶.pmx → 里芙.pmx
simpleRename(51, '无限之视-爱意凝晶.pmx', '里芙.pmx')

// 47-苍鹭·托特(入暮之诗): 托特.pmx → 苍鹭·托特.pmx
simpleRename(47, '托特.pmx', '苍鹭·托特.pmx')

// 48-苍鹭·托特(白衣): 苍鹭·托特「扉页之吻」白衣1.0.pmx → 苍鹭·托特_白衣.pmx
simpleRename(48, '苍鹭·托特「扉页之吻」白衣1.0.pmx', '苍鹭·托特_白衣.pmx')

// 49-苍鹭·托特(黑衣): 苍鹭·托特「扉页之吻」黑衣1.0.pmx → 苍鹭·托特_黑衣.pmx
simpleRename(49, '苍鹭·托特「扉页之吻」黑衣1.0.pmx', '苍鹭·托特_黑衣.pmx')

// 27-弱音(A): 弱音.pmx → 弱音_A.pmx
simpleRename(27, '弱音.pmx', '弱音_A.pmx')

// 28-弱音(B): 弱音2.pmx → 弱音_B.pmx
simpleRename(28, '弱音2.pmx', '弱音_B.pmx')

// 39-玛薇卡(基础): 玛薇卡1.pmx → 玛薇卡_基础版.pmx
simpleRename(39, '玛薇卡1.pmx', '玛薇卡_基础版.pmx')

// 40-玛薇卡(高精): 玛薇卡2.pmx → 玛薇卡_高精版.pmx
simpleRename(40, '玛薇卡2.pmx', '玛薇卡_高精版.pmx')

// 53-雷电将军(武器): 武器.pmx → 雷电将军_武器.pmx
simpleRename(53, '武器.pmx', '雷电将军_武器.pmx')

// 54-雷电将军(标准): 雷电将军.pmx 不变
simpleRename(54, '雷电将军.pmx', '雷电将军.pmx')

// ======================== Group 2: 扁平化 ========================

// --- Gratia (ID:1) ---
// 结构: Gratia+其他/Gratia_MMD/Gratia.pmx + Gratia_MMD/tex/ + Gratia_MMD/Gratia/
plan.push({
  id: 1,
  oldDir: 'Gratia+其他/Gratia_MMD',
  oldFile: 'Gratia.pmx',
  newDir: 'Gratia+其他',
  newFile: 'Gratia.pmx',
  moves: [
    { from: 'Gratia+其他/Gratia_MMD/tex', to: 'Gratia+其他/tex' },
    { from: 'Gratia+其他/Gratia_MMD/Gratia', to: 'Gratia+其他/Gratia' },
  ],
})

// --- 世界计划 拆分为4个独立文件夹 (ID:2,3,4,5) ---
plan.push({
  id: 2,
  oldDir: '世界计划+Project Sekai/ena',
  oldFile: 'ena.pmx',
  newDir: '絵名+Project Sekai',
  newFile: '絵名.pmx',
  moves: [{ from: '世界计划+Project Sekai/ena/tex', to: '絵名+Project Sekai/tex' }],
})
plan.push({
  id: 3,
  oldDir: '世界计划+Project Sekai/knd',
  oldFile: 'knd.pmx',
  newDir: '奏+Project Sekai',
  newFile: '奏.pmx',
  moves: [{ from: '世界计划+Project Sekai/knd/tex', to: '奏+Project Sekai/tex' }],
})
plan.push({
  id: 4,
  oldDir: '世界计划+Project Sekai/mfy',
  oldFile: 'mfy.pmx',
  newDir: 'Mafuyu+Project Sekai',
  newFile: 'Mafuyu.pmx',
  moves: [{ from: '世界计划+Project Sekai/mfy/tex', to: 'Mafuyu+Project Sekai/tex' }],
})
plan.push({
  id: 5,
  oldDir: '世界计划+Project Sekai/mzk',
  oldFile: 'mzk.pmx',
  newDir: '瑞希+Project Sekai',
  newFile: '瑞希.pmx',
  moves: [{ from: '世界计划+Project Sekai/mzk/tex', to: '瑞希+Project Sekai/tex' }],
})

// --- 尤诺 (ID:25) ---
plan.push({
  id: 25,
  oldDir: '尤诺+鸣潮/尤诺',
  oldFile: '尤诺.pmx',
  newDir: '尤诺+鸣潮',
  newFile: '尤诺.pmx',
  moves: [],
})

// --- 八重神子[蒙德究史尼] (ID:12) ---
plan.push({
  id: 12,
  oldDir: '八重神子+原神[蒙德究史尼]/八重神子_未和谐版',
  oldFile: '八重神子_未和谐版.pmx',
  newDir: '八重神子+原神[蒙德究史尼]',
  newFile: '八重神子_未和谐.pmx',
  moves: [
    {
      from: '八重神子+原神[蒙德究史尼]/八重神子_未和谐版/sph',
      to: '八重神子+原神[蒙德究史尼]/sph',
    },
    {
      from: '八重神子+原神[蒙德究史尼]/八重神子_未和谐版/tex',
      to: '八重神子+原神[蒙德究史尼]/tex',
    },
    {
      from: '八重神子+原神[蒙德究史尼]/八重神子_未和谐版/游戏内原版贴图(带透明通道)',
      to: '八重神子+原神[蒙德究史尼]/游戏内原版贴图',
    },
  ],
})

// --- 凯茜娅 (ID:14) ---
plan.push({
  id: 14,
  oldDir: '凯茜娅+尘白禁区[神帝宇]/凯茜娅-狂诗 星抚恋音',
  oldFile: '凯茜娅-狂诗 星抚恋音a1.0.pmx',
  newDir: '凯茜娅+尘白禁区[神帝宇]',
  newFile: '凯茜娅.pmx',
  moves: [],
})

// --- 太一·庚辰 (ID:16) ---
plan.push({
  id: 16,
  oldDir: '太一·庚辰+深空之眼/深空之眼—太一·庚辰-海上的私语/太一·庚辰-海上的私语',
  oldFile: '庚辰6.0.pmx',
  newDir: '太一·庚辰+深空之眼',
  newFile: '太一·庚辰.pmx',
  moves: [],
})

// --- 安卡希雅(尘白) 标准版 (ID:19) ---
plan.push({
  id: 19,
  oldDir: '安卡希雅+尘白禁区[神帝宇]/安卡希雅-时之重奏 缘音回响/安卡希雅-时之重奏 缘音回响',
  oldFile: '安卡希雅-时之重奏 缘音回响a2.0.pmx',
  newDir: '安卡希雅+尘白禁区[神帝宇]',
  newFile: '安卡希雅.pmx',
  moves: [],
})

// --- 安卡希雅(尘白) 成长后 (ID:20) ---
plan.push({
  id: 20,
  oldDir: '安卡希雅+尘白禁区[神帝宇]/安卡希雅-时之重奏 缘音回响/安卡希雅-时之重奏 缘音回响 成长后',
  oldFile: '安卡希雅-时之重奏 缘音回响 成长后a1.0.pmx',
  newDir: '安卡希雅+尘白禁区[神帝宇]',
  newFile: '安卡希雅_成长后.pmx',
  moves: [],
})

// --- 安卡希雅(战双) 成长后 (ID:21) ---
plan.push({
  id: 21,
  oldDir: '安卡希雅+战双帕弥什[神帝宇]/安卡希雅-时之重奏/安卡希雅-时之重奏 成长后',
  oldFile: '安卡希雅-时之重奏 成长后a1.0.pmx',
  newDir: '安卡希雅+战双帕弥什[神帝宇]',
  newFile: '安卡希雅_成长后.pmx',
  moves: [],
})

// --- 安卡希雅(战双) 标准版 (ID:22) ---
plan.push({
  id: 22,
  oldDir: '安卡希雅+战双帕弥什[神帝宇]/安卡希雅-时之重奏/安卡希雅-时之重奏未',
  oldFile: '安卡希雅-时之重奏a2.0.pmx',
  newDir: '安卡希雅+战双帕弥什[神帝宇]',
  newFile: '安卡希雅.pmx',
  moves: [],
})

// --- 月下誓约德丽莎 (ID:35,36) ---
plan.push({
  id: 35,
  oldDir: '月下誓约德丽莎+崩坏3[微波叮桃子]/月下誓约-此生永携',
  oldFile: '月下誓约-此生永携.pmx',
  newDir: '月下誓约德丽莎+崩坏3[微波叮桃子]',
  newFile: '月下誓约德丽莎.pmx',
  moves: [],
})
plan.push({
  id: 36,
  oldDir: '月下誓约德丽莎+崩坏3[微波叮桃子]/月下誓约-此生永携',
  oldFile: '月下誓约-此生永携(N版).pmx',
  newDir: '月下誓约德丽莎+崩坏3[微波叮桃子]',
  newFile: '月下誓约德丽莎_N.pmx',
  moves: [],
})

// --- 琴 (ID:41) ---
plan.push({
  id: 41,
  oldDir: '琴+原神/琴',
  oldFile: '琴.pmx',
  newDir: '琴+原神',
  newFile: '琴.pmx',
  moves: [],
})

// --- 瓦吉特 (ID:42) ---
plan.push({
  id: 42,
  oldDir: '瓦吉特+深空之眼[蒙德究史尼]/瓦吉特清凉版_MDJSN_edit_v1.0_模之屋配布用',
  oldFile: '瓦吉特清凉版v1.0.pmx',
  newDir: '瓦吉特+深空之眼[蒙德究史尼]',
  newFile: '瓦吉特.pmx',
  moves: [],
})

// --- 阮梅 (ID:52) ---
plan.push({
  id: 52,
  oldDir: '阮梅+崩坏-星穹铁道[蒙德究史尼]/阮梅素体_MDJSN_edit_v1.1_模之屋配布用',
  oldFile: '阮梅素体v1.1.pmx',
  newDir: '阮梅+崩坏-星穹铁道[蒙德究史尼]',
  newFile: '阮梅.pmx',
  moves: [],
})

// --- 芬妮 (ID:46) ---
plan.push({
  id: 46,
  oldDir: '芬妮+尘白禁区[神帝宇]/芬妮-澄意 夕晖蜜约',
  oldFile: '芬妮-澄意 夕晖蜜约a1.0.pmx',
  newDir: '芬妮+尘白禁区[神帝宇]',
  newFile: '芬妮.pmx',
  moves: [],
})

// --- 妃色 (ID:17) 巳在根, 确认不需要变 ---
// 妃色+幻塔[HT]/妃色.pmx 已经在根目录,保持不变

// --- 坎特蕾拉 (ID:15)、凝光(13)、优菈(8)、八重神子标准(10)、芙宁娜(45) 已在根,不变 ---

// ======================== 执行阶段 ========================
console.log('========================================')
console.log('  模型文件重组 — 执行计划')
console.log('========================================')
console.log('变更项: ' + plan.length + ' 条')
console.log('')

// Phase 1: 验证所有源文件存在
console.log('=== Phase 1: 源文件验证 ===')
let allOk = true
for (const p of plan) {
  const oldPath = path.join(MODELS_DIR, p.oldDir, p.oldFile)
  if (!fs.existsSync(oldPath)) {
    console.log('❌ ID:' + p.id + ' 源文件不存在: ' + oldPath)
    allOk = false
  }
}
if (allOk) {
  console.log('✅ 所有源文件验证通过')
} else {
  console.log('❌ 验证失败,终止执行')
  process.exit(1)
}

// Phase 1.5: 验证 moves 的来源目录存在
console.log('\n=== Phase 1.5: 移动目录来源验证 ===')
for (const p of plan) {
  for (const m of p.moves || []) {
    const fromPath = path.join(MODELS_DIR, m.from)
    if (!fs.existsSync(fromPath)) {
      console.log('⚠️  目录不存在(跳过): ' + m.from)
    }
  }
}

// Phase 2: 创建新目录、移动文件
console.log('\n=== Phase 2: 执行文件移动/重命名 ===')

const executor = db.transaction(() => {
  for (const p of plan) {
    const oldFull = path.join(MODELS_DIR, p.oldDir, p.oldFile)
    const newFull = path.join(MODELS_DIR, p.newDir, p.newFile)

    // 确保目标目录存在
    if (!fs.existsSync(path.join(MODELS_DIR, p.newDir))) {
      fs.mkdirSync(path.join(MODELS_DIR, p.newDir), { recursive: true })
    }

    // 移动 PMX 文件
    if (oldFull !== newFull) {
      // 也移动同名 .gz 文件
      const gzOld = oldFull + '.gz'
      const gzNew = newFull + '.gz'

      console.log(
        '  📄 ' + path.relative(MODELS_DIR, oldFull) + ' → ' + path.relative(MODELS_DIR, newFull),
      )
      fs.renameSync(oldFull, newFull)

      if (fs.existsSync(gzOld)) {
        console.log(
          '  📄 ' + path.relative(MODELS_DIR, gzOld) + ' → ' + path.relative(MODELS_DIR, gzNew),
        )
        fs.renameSync(gzOld, gzNew)
      }
    } else {
      console.log('  ⏭️  PMX路径不变: ' + path.relative(MODELS_DIR, newFull))
    }

    // 移动子目录
    for (const m of p.moves || []) {
      const fromPath = path.join(MODELS_DIR, m.from)
      const toPath = path.join(MODELS_DIR, m.to)
      if (fs.existsSync(fromPath) && !fs.existsSync(toPath)) {
        // 确保父目录存在
        const toParent = path.dirname(toPath)
        if (!fs.existsSync(toParent)) {
          fs.mkdirSync(toParent, { recursive: true })
        }
        console.log('  📁 ' + m.from + ' → ' + m.to)
        fs.renameSync(fromPath, toPath)
      } else if (fs.existsSync(toPath)) {
        console.log('  ⚠️  目标已存在,跳过: ' + m.to)
      }
    }

    // 更新数据库
    db.prepare('UPDATE model_configs SET folder=?, file=? WHERE id=?').run(
      p.newDir,
      p.newFile,
      p.id,
    )

    console.log('  💾 DB更新: [' + p.id + '] folder=' + p.newDir + ' file=' + p.newFile)
  }
})

executor()
console.log('\n✅ Phase 2 完成')

// Phase 3: 清理旧空目录
console.log('\n=== Phase 3: 清理旧空目录 ===')
// 删除世界计划合集(已拆分)
const oldDirsToRemove = [
  '世界计划+Project Sekai',
  'Gratia+其他/Gratia_MMD',
  '八重神子+原神[蒙德究史尼]/八重神子_未和谐版',
  '凯茜娅+尘白禁区[神帝宇]/凯茜娅-狂诗 星抚恋音',
  '太一·庚辰+深空之眼/深空之眼—太一·庚辰-海上的私语',
  '安卡希雅+尘白禁区[神帝宇]/安卡希雅-时之重奏 缘音回响',
  '安卡希雅+战双帕弥什[神帝宇]/安卡希雅-时之重奏',
  '月下誓约德丽莎+崩坏3[微波叮桃子]/月下誓约-此生永携',
  '琴+原神/琴',
  '尤诺+鸣潮/尤诺',
  '瓦吉特+深空之眼[蒙德究史尼]/瓦吉特清凉版_MDJSN_edit_v1.0_模之屋配布用',
  '阮梅+崩坏-星穹铁道[蒙德究史尼]/阮梅素体_MDJSN_edit_v1.1_模之屋配布用',
  '芬妮+尘白禁区[神帝宇]/芬妮-澄意 夕晖蜜约',
]

for (const d of oldDirsToRemove) {
  const full = path.join(MODELS_DIR, d)
  if (fs.existsSync(full)) {
    try {
      fs.rmSync(full, { recursive: true, force: true })
      console.log('  🗑️  已删除: ' + d)
    } catch (e) {
      // 可能非空(有其他文件),先列出内容
      console.log('  ⚠️  无法删除(可能非空): ' + d + ' — ' + e.message)
      try {
        const files = fs.readdirSync(full)
        console.log('      剩余文件: ' + files.join(', '))
      } catch (_) {}
    }
  }
}

console.log('\n✅ Phase 3 完成')

// Phase 4: 最终验证
console.log('\n=== Phase 4: 最终验证 ===')
const finalAll = db
  .prepare('SELECT id, name, folder, file FROM model_configs WHERE enabled=1 ORDER BY id')
  .all()
let finalOk = 0,
  finalBad = 0
const finalBadList = []

finalAll.forEach((m) => {
  const fp = path.join(MODELS_DIR, m.folder, m.file)
  if (fs.existsSync(fp)) {
    finalOk++
  } else {
    finalBad++
    // Check what exists
    const dirPath = path.join(MODELS_DIR, m.folder)
    let hint = ''
    if (fs.existsSync(dirPath)) {
      const pmxFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith('.pmx'))
      hint = ' 实际PMX: ' + pmxFiles.join(', ')
    } else {
      hint = ' 目录不存在'
    }
    finalBadList.push('❌ [' + m.id + '] ' + m.name + ' | ' + m.folder + '/' + m.file + hint)
  }
})

console.log('✅ ' + finalOk + ' | ❌ ' + finalBad + ' | 总计 ' + finalAll.length)
if (finalBad > 0) {
  console.log('\n=== 失败项 ===')
  finalBadList.forEach((b) => console.log(b))
}

console.log('\n=== 完成后文件夹列表 ===')
const topDirs = fs
  .readdirSync(MODELS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_bak_') && d.name !== 'zip备份')
  .map((d) => d.name)
  .sort()
topDirs.forEach((d) => {
  const pmxFiles = fs.readdirSync(path.join(MODELS_DIR, d)).filter((f) => f.endsWith('.pmx'))
  console.log('  📁 ' + d + ' (' + pmxFiles.length + ' PMX: ' + pmxFiles.join(', ') + ')')
})

db.close()
console.log('\n🎉 全部完成!')
