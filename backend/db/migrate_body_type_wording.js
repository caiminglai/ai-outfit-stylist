/**
 * 体型词形统一 + 胖瘦档归位（10-19 第一阶段·止血第 1 条的数据侧）
 *
 * 干两件事，都是纯词形/字段名搬家，不改一条规则的内容文案（除了把「苹果形」改成「苹果型」）：
 *   A. 「苹果形」→「苹果型」。引擎出的是「苹果型」，库里 4 条写「苹果形」
 *      （组 199/200/206/207），严格 AND 下这 4 组从写下起一次没命中过。
 *   B. 把 body_type 上的「偏瘦/偏胖」平移到 bmi_level（10 条，组 201-213 那批 store 规则）。
 *      「偏瘦/偏胖」是 BMI 档不是体型，词表在 services/bmi.js 的 HEALTH_BANDS，
 *      两个名字一字一样；而门店表单本来就收身高+体重，enrichProfile 一定算得出 bmi_level
 *      ⇒ 挪过去之后这 10 条由"顾客自己勾胖瘦"变成"按实测高体重自动判"，命中面只增不减。
 *
 * 实测命中面变化（10-19 本机引擎跑同一份规则，两遍只换这几处存值）：
 *   女·通勤·160cm/68kg（BMI 26.6 → 偏胖）  改前命中 1 组 [309]        → 改后 2 组 [309, 201]
 *   男·通勤·178cm/55kg（BMI 17.4 → 偏瘦）  改前命中 3 组 [309,8,230]  → 改后 4 组 [309,8,210,230]
 *   没有一组原本能命中的规则被改坏；只有新增，没有减少。
 *
 * 为什么还要跑这个脚本（引擎与规则两侧都已做词形归一，不跑也能命中）：
 *   recommendEngine.COND_VALUE_ALIASES 与 profileEnricher.normalizeBodyType 已经让
 *   老存值照样命中，脚本管的是**后台可读性**——后台规则编辑器里那颗条件下拉会显示
 *   「体型 = 偏瘦」这种自相矛盾的写法，店员照着加规则就会继续抄错。
 *   ⚠️ 服务器那份运行库被 skip-worktree 钉住，本脚本要在服务器上单独跑一次：
 *      node db/migrate_body_type_wording.js   （先 STYLEAI_DB_PATH 指到副本试跑，见文件尾）
 *
 * 两种模式：
 *   （默认）改数据库：node db/migrate_body_type_wording.js
 *   改种子快照：  node db/migrate_body_type_wording.js --seed
 *   --seed 存在的理由：seed/rules.json 是这份库的导出快照，被 09-28 之后的新增规则拉开了一截。
 *   直接重新导出会把无关漂移一起拖进本轮 diff ⇒ 这里只做定点改写，字节层面除了这几处存值
 *   和「苹果形」三字其余一字不动（脚本末尾会打改动条数，跑完 git diff --stat 该只有 rules.json）。
 *
 * 幂等：逐行按"归一后是否与原值相同"决定改不改，重跑第二次应当 0 改动，末尾会打这个数。
 * 原子性：库模式照 db/migrate_cn_category.js 的写法整体进事务，没跑到底就 ROLLBACK，
 *         不许停在「A 改完 B 没改」的半套状态；种子模式先把所有文件全算完，
 *         任何一份算出问题就一个文件都不写盘。
 */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { DB_PATH } = require('./paths')
const { BODY_TYPES, normalizeBodyType } = require('../services/bodyTypes')
const { HEALTH_BANDS } = require('../services/bmi')

const BMI_WORDS = HEALTH_BANDS.map((b) => b.level)

/**
 * 把一条条件的存值拆成裸字符串。同一颗字段有三种写法（10-19 现量，判据＝库模式尾部的 SELECT）：
 *   {"body_type": "沙漏型"}   带壳、冒号后有空格（db/add-rules.js 那批老规则）
 *   {"body_type":"梨形"}      带壳、无空格（applyRuleSeeds 写的形状）
 *   "偏瘦"                    裸的 JSON 串（更老的一批，height_range/gender 也这么存）
 *   偏瘦                      不是 JSON 的裸串（种子文件 rules[].conditions[].value 全是这种）
 * 写回时保持原来那种形状，只换字，不顺手把形状统一成另一种——形状一变，
 * 后台编辑器读出来的样子就变了，而这一轮只该改词形。
 */
function readCondValue(raw, field) {
  const s = String(raw)
  const t = s.trim()
  const shape = t.startsWith('{') ? 'wrapped' : t.startsWith('"') ? 'quoted' : 'plain'
  let v = s
  try {
    v = JSON.parse(s)
  } catch {
    /* 不是 JSON，原样当字符串 */
  }
  const isList = Array.isArray(v)
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    v = Object.prototype.hasOwnProperty.call(v, field) ? v[field] : Object.values(v)[0]
  }
  return { parsed: v, shape, isList }
}

/** 按原形状写回：带壳的还带壳（引擎按 {"<field>": ...} 取值），带引号的还带引号，裸的还裸的 */
function writeCondValue(value, shape, field) {
  if (shape === 'wrapped') return JSON.stringify({ [field]: value })
  if (shape === 'quoted') return JSON.stringify(String(value))
  return String(value)
}

/**
 * 一条 body_type / bmi_level 条件该不该动、动成什么。
 * 返回 { action: 'noop' | 'rename' | 'moveToBmi', field?, value?, why? }
 * why 非空 ⇒ 这条本脚本看不懂，只报不改（宁可不改，不许猜）。
 */
function decideCond(field, raw) {
  const { parsed, shape, isList } = readCondValue(raw, field)
  const value = String(parsed === null || parsed === undefined ? '' : parsed).trim()

  // 'in' 操作符的存值是数组，现量：body_type 28 条全是 eq，没有列表写法
  // ⇒ 真遇到就先报出来不猜，别把数组按字符串改坏。
  if (isList || value.includes('、')) return { action: 'noop', why: `列表写法「${value}」` }
  if (!value || value === 'all') return { action: 'noop' }

  if (field === 'bmi_level') {
    if (!BMI_WORDS.includes(value))
      return { action: 'noop', why: `bmi_level="${value}" 不在 ${BMI_WORDS.join('/')} 里` }
    return { action: 'noop' }
  }
  if (field !== 'body_type') return { action: 'noop', why: `不该出现在这里的字段 ${field}` }

  // 胖瘦档归位：名字一字不改，只换字段名与 JSON 的键
  if (BMI_WORDS.includes(value)) {
    return {
      action: 'moveToBmi',
      field: 'bmi_level',
      value: writeCondValue(value, shape, 'bmi_level'),
    }
  }
  const canonical = normalizeBodyType(value)
  if (!BODY_TYPES.includes(canonical)) {
    return { action: 'noop', why: `body_type="${value}" 既不是五档也不是 BMI 档` }
  }
  if (canonical !== value) {
    return {
      action: 'rename',
      field: 'body_type',
      value: writeCondValue(canonical, shape, 'body_type'),
    }
  }
  return { action: 'noop' }
}

/** 文案里的「苹果形」→「苹果型」；这是本轮唯一允许碰顾客可见文字的地方 */
function reword(s) {
  return String(s === null || s === undefined ? '' : s)
    .split('苹果形')
    .join('苹果型')
}

// ==================== 库模式 ====================

function runDbMode() {
  const db = new Database(DB_PATH)
  console.log(`=== 体型词形统一（库模式）===\n目标库: ${DB_PATH}`)

  db.exec('BEGIN IMMEDIATE')
  let committed = false
  process.on('exit', () => {
    if (!committed) {
      try {
        db.exec('ROLLBACK')
        console.log('（没跑到底，本轮改动已回滚）')
      } catch {
        /* 连接已关，未提交的事务本来就不落盘 */
      }
    }
  })

  let renamedWord = 0
  let movedToBmi = 0
  let untouched = 0
  const odd = []

  const condRows = db
    .prepare(
      "SELECT id, group_id, field, operator, value, weight FROM rule_conditions WHERE field IN ('body_type','bmi_level')",
    )
    .all()
  const setCond = db.prepare('UPDATE rule_conditions SET field = ?, value = ? WHERE id = ?')

  for (const row of condRows) {
    const d = decideCond(row.field, row.value)
    if (d.why) {
      odd.push(`条件 ${row.id}(组 ${row.group_id}) ${d.why}，本脚本不自动改，请人工确认`)
      continue
    }
    if (d.action === 'noop') {
      untouched++
      continue
    }
    setCond.run(d.field, d.value, row.id)
    if (d.action === 'rename') renamedWord++
    else movedToBmi++
  }
  console.log(
    `条件侧：词形改掉 ${renamedWord} 条 | 胖瘦档挪到 bmi_level ${movedToBmi} 条 | 原样不动 ${untouched} 条`,
  )

  // 组名/描述/动作文案里的「苹果形」跟着改，否则后台列表和顾客报告还显示老词
  const setGroup = db.prepare('UPDATE rule_groups SET name = ?, description = ? WHERE id = ?')
  let groupChanged = 0
  for (const g of db.prepare('SELECT id, name, description FROM rule_groups').all()) {
    const n = reword(g.name)
    const d = reword(g.description)
    if (n !== g.name || d !== g.description) {
      setGroup.run(n, d, g.id)
      groupChanged++
    }
  }
  const setAction = db.prepare('UPDATE rule_actions SET content = ? WHERE id = ?')
  let actionChanged = 0
  for (const a of db.prepare('SELECT id, content FROM rule_actions').all()) {
    const c = reword(a.content)
    if (c !== a.content) {
      setAction.run(c, a.id)
      actionChanged++
    }
  }
  console.log(
    `文案侧：规则组 ${groupChanged} 条 | 规则动作 ${actionChanged} 条 里的「苹果形」→「苹果型」`,
  )

  // ===== 验证（跑到底才 COMMIT，这几条不干净就整笔回滚）=====
  // 幂等自证 + 残留清零两把尺子：前者＝改完再喂一遍 decideCond 不该还有要动的；后者＝「苹果形」三字全库查无
  const stillChangeable = db
    .prepare(
      "SELECT id, group_id, field, value FROM rule_conditions WHERE field IN ('body_type','bmi_level')",
    )
    .all()
    .filter((r) => decideCond(r.field, r.value).action !== 'noop')
  const residue = db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM rule_conditions WHERE field='body_type' AND value LIKE '%苹果形%') c1, (SELECT COUNT(*) FROM rule_conditions WHERE field='body_type' AND (value LIKE '%偏瘦%' OR value LIKE '%偏胖%' OR value LIKE '%正常%' OR value LIKE '%肥胖%')) c2, (SELECT COUNT(*) FROM rule_groups WHERE name LIKE '%苹果形%' OR description LIKE '%苹果形%') c3, (SELECT COUNT(*) FROM rule_actions WHERE content LIKE '%苹果形%') c4",
    )
    .get()
  console.log(
    `\n验证：还能被本脚本改的 ${stillChangeable.length} 条（应为 0）| 残留「苹果形」条件 ${residue.c1} / 组 ${residue.c3} / 动作 ${residue.c4} 条 | body_type 上还挂着胖瘦词 ${residue.c2} 条（应为 0）`,
  )
  for (const r of stillChangeable)
    console.log(`  ⚠️ 条件 ${r.id}(组 ${r.group_id}) ${r.field}: ${r.value}`)
  for (const m of odd) console.log(`  ⚠️ ${m}`)

  if (stillChangeable.length > 0 || residue.c1 + residue.c2 + residue.c3 + residue.c4 > 0) {
    db.exec('ROLLBACK')
    console.log('\n❌ 验证没过，整笔回滚，库里一个字都没改。请先处理上面列出的条目。')
    db.close()
    process.exit(1)
  }

  db.exec('COMMIT')
  committed = true
  console.log(
    '\n✅ 已提交。重跑本脚本应当报「词形改掉 0 条 / 挪到 bmi_level 0 条」，那是幂等自证。',
  )
  console.log(
    `现量：rule_groups ${db.prepare('SELECT COUNT(*) n FROM rule_groups').get().n} | rule_conditions ${db.prepare('SELECT COUNT(*) n FROM rule_conditions').get().n} | rule_actions ${db.prepare('SELECT COUNT(*) n FROM rule_actions').get().n}`,
  )
  db.close()
}

// ==================== 种子模式 ====================

/**
 * 种子文件有两种形状，都得吃：
 *   rules.json            由 db/export-rules.js 导出 ⇒ {rule_groups, rule_conditions, rule_actions}
 *   rules-*.json          applyRuleSeeds 的输入 ⇒ {rules:[{name,description,conditions,actions}]}
 * 后者没有 id/group_id（靠 key 定位），conditions[].value 是裸串 ⇒ decideCond 的 plain 分支正好对上。
 */
function transformSnapshot(data) {
  const stat = { renamed: 0, moved: 0, groups: 0, actions: 0, odd: [] }

  // ---- 导出快照形状 ----
  if (Array.isArray(data.rule_conditions)) {
    for (const c of data.rule_conditions) {
      if (c.field !== 'body_type' && c.field !== 'bmi_level') continue
      const d = decideCond(c.field, c.value)
      if (d.why) {
        stat.odd.push(`条件 id=${c.id}(组 ${c.group_id}) ${d.why}`)
        continue
      }
      if (d.action === 'noop') continue
      c.field = d.field
      c.value = d.value
      if (d.action === 'rename') stat.renamed++
      else stat.moved++
    }
  }
  if (Array.isArray(data.rule_groups)) {
    for (const g of data.rule_groups) {
      const n = reword(g.name)
      const d = reword(g.description)
      if (n !== g.name || d !== g.description) {
        g.name = n
        g.description = d
        stat.groups++
      }
    }
  }
  if (Array.isArray(data.rule_actions)) {
    for (const a of data.rule_actions) {
      const c = reword(a.content)
      if (c !== a.content) {
        a.content = c
        stat.actions++
      }
    }
  }

  // ---- applyRuleSeeds 形状 ----
  if (Array.isArray(data.rules)) {
    for (const r of data.rules) {
      for (const c of r.conditions || []) {
        if (c.field !== 'body_type' && c.field !== 'bmi_level') continue
        const d = decideCond(c.field, c.value)
        if (d.why) {
          stat.odd.push(`规则 ${r.key || r.name} 条件 ${c.field} ${d.why}`)
          continue
        }
        if (d.action === 'noop') continue
        c.field = d.field
        c.value = d.value
        if (d.action === 'rename') stat.renamed++
        else stat.moved++
      }
      const n = reword(r.name)
      const dd = reword(r.description)
      if (n !== r.name || dd !== r.description) {
        r.name = n
        r.description = dd
        stat.groups++
      }
      for (const a of r.actions || []) {
        const c = reword(a.content)
        if (c !== a.content) {
          a.content = c
          stat.actions++
        }
      }
    }
  }

  return stat
}

function runSeedMode() {
  const dir = path.join(__dirname, 'seed')
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^rules.*\.json$/.test(f))
    .sort()
  console.log(`=== 体型词形统一（种子模式）===\n目标目录: ${dir}\n候选文件: ${files.join(', ')}`)

  // 先把所有文件全算完再一次性写盘：任何一份读不出 JSON 就整轮不写，
  // 不许停在「rules.json 改了、rules-aesthetic.json 没改」的半套状态。
  //
  // ⚠️ 排版闸门（10-19 实测踩到的坑）：三份 rules-*.json 是人手/生成器写的，
  // conditions 与 actions 是「一行一个对象」的紧凑写法，而 export-rules.js 写的
  // rules.json 是标准两空格缩进。同一份内容 JSON.stringify(x,null,2) 前者会整篇重排
  // （rules-wuxing 19,556 → 22,976 字节、diff 550 行），把一轮词形改动做成排版噪音。
  // ⇒ 只写"序列化回去与原文一字一样、且本轮确有改动"的文件；对不上就报出来让人去源头改。
  const queued = []
  for (const f of files) {
    const p = path.join(dir, f)
    const before = fs.readFileSync(p, 'utf8')
    const tail = before.endsWith('\n') ? '\n' : ''
    const work = JSON.parse(before)
    // 排版能否原样还原要用"未改动"的内容判：改动后的内容必然与原文不同，比不出排版
    const roundtrips = JSON.stringify(JSON.parse(before), null, 2) + tail === before
    const written = transformSnapshot(work)
    const after = JSON.stringify(work, null, 2) + tail
    queued.push({
      f,
      p,
      before,
      after,
      stat: written,
      changes: written.renamed + written.moved + written.groups + written.actions,
      roundtrips,
    })
  }

  let changedFiles = 0
  let skippedForLayout = 0
  for (const q of queued) {
    const head = `  ${q.f}: 词形 ${q.stat.renamed} | 挪 bmi_level ${q.stat.moved} | 组文案 ${q.stat.groups} | 动作文案 ${q.stat.actions}`
    if (q.changes === 0) {
      console.log(`${head} → 无改动`)
      continue
    }
    if (!q.roundtrips) {
      console.log(`${head} → ⛔ 没写盘`)
      console.log(
        `     这份文件的缩进不是 JSON.stringify(_,null,2) 的形状，改写会整篇重排（排版噪音盖住内容改动）。` +
          `\n     本轮它没有 body_type 条件时可不管；若真有，请直接在源头文件（db/add-rules.js 或手写种子）里改。`,
      )
      skippedForLayout++
      continue
    }
    console.log(head)
    fs.writeFileSync(q.p, q.after, 'utf8')
    changedFiles++
  }
  console.log(
    `\n写盘文件 ${changedFiles} / ${queued.length}${skippedForLayout ? ` | 因排版不还原被挡下 ${skippedForLayout} 份` : ''}`,
  )

  // 验证：拿刚写进盘的那份字节重新解析、再喂一遍 decideCond，应当一条都改不动了
  let left = 0
  let residue = 0
  for (const q of queued) {
    const now = JSON.parse(fs.readFileSync(q.p, 'utf8'))
    const recheck = transformSnapshot(now)
    left += recheck.renamed + recheck.moved
    for (const list of [
      now.rule_conditions,
      now.rules ? now.rules.flatMap((r) => r.conditions || []) : [],
    ]) {
      for (const c of list || []) {
        if (c.field === 'body_type' && String(c.value).includes('苹果形')) residue++
      }
    }
  }
  for (const q of queued) for (const m of q.stat.odd) console.log(`  ⚠️ ${q.f} ${m}`)
  console.log(
    `验证：幂等复算还能改的 ${left} 条（应为 0）| 盘上残留「苹果形」体型条件 ${residue} 条（应为 0）`,
  )
  if (left > 0 || residue > 0) {
    console.log('\n❌ 验证没过。文件已写盘，请按上面条目人工核对后重跑。')
    process.exit(1)
  }
  console.log('\n✅ 种子已归一。重跑本命令报「无改动」即幂等自证。')
}

if (process.argv.includes('--seed')) runSeedMode()
else runDbMode()

// 试跑法（不碰活库）：
//   复制库到盘外 ⇒ cp backend/db/styleai.db "E:/website/站3产生临时文件/xxx/mig.db"
//   跑副本       ⇒ STYLEAI_DB_PATH="E:/website/站3产生临时文件/xxx/mig.db" node db/migrate_body_type_wording.js
//   跑第二遍     ⇒ 同一条命令，应报「词形改掉 0 条 / 挪到 bmi_level 0 条」
