/**
 * 人体测量点词表（`services/bodyMeasureVocab.js`）的单测
 * ============================================================
 * 建档：2026-10-23（第十五阶段·第一步）。口径在
 * `docs/依据/23-人体测量字段词表输入输出规范-20261023.md`，本文件守的是**漂移**，不是数值。
 *
 * 这一层没有公式、没有阈值，所以它能坏的方式只有三种，每种都有对应断言：
 *  ① 上游原件被改动（格式化、"顺手统一行尾"、升级 vendor）⇒ 与 PROVENANCE 登记的字节不再相等（第一组）
 *  ② 本表与上游一字不一样（改名、增删点、调换顺序）⇒ 双向逐字对照（第二、三组）
 *  ③ 后来人往这张"只记名"的表里塞数值 ⇒ 结构闸门（第四组）＋ 激素型混进对照表（第五组）
 * 另外守两条站内自身的对齐：`column` 必须真的在 `bodyLimits.js` 那一把尺子里（第六组），
 * 五档取值必须是 `bodyTypes.js` 的那五颗（第七组）。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const vocab = require('../services/bodyMeasureVocab')
const { LIMITS } = require('../services/bodyLimits')
const { BODY_TYPES } = require('../services/bodyTypes')

const {
  VENDOR_DIR,
  VENDOR_MEASURE,
  VENDOR_BODYSHAPES,
  MEASURE_POINTS,
  REPO_COLUMNS_WITHOUT_MH_POINT,
  BODY_SHAPE_CROSSWALK,
  HORMONE_SHAPE_MODS,
  vendorMeasureMods,
  vendorBodyShapes,
  measurePointByColumn,
  measurePointByKey,
  measurePointsWithoutRepoColumn,
  bodyTypeFromShape,
} = vocab

const PROVENANCE = path.join(VENDOR_DIR, 'PROVENANCE.md')

// ------------------------------------------------------------
// ① vendor 原件：字节必须还是引进那天登记的那份
// ------------------------------------------------------------

test('vendor 三份原件的 md5 与 PROVENANCE.md 登记的数字逐一对得上（有人格式化或换版就该红）', () => {
  const reg = fs.readFileSync(PROVENANCE, 'utf8')
  for (const file of ['measurement_sliders.json', 'bodyshapes_sliders.json', 'LICENSE.md']) {
    const bytes = fs.readFileSync(path.join(VENDOR_DIR, file))
    const md5 = crypto.createHash('md5').update(bytes).digest('hex')
    assert.ok(
      reg.includes(md5),
      `${file} 的 md5 ${md5} 不在 PROVENANCE 登记表里——原件被改过或登记没更新`,
    )
    // 登记行里的字节数也要对得上（只校 md5 会放过"改完顺手把 md5 也改了"的情况）
    const row = reg.split('\n').find((l) => l.includes(md5)) || ''
    assert.ok(
      row.includes(`| ${bytes.length} |`),
      `${file} 实际 ${bytes.length} 字节与 PROVENANCE 登记不一致`,
    )
  }
})

test('两个 JSON 的行尾保持上游的 CRLF（⛔ 被"统一成纯 LF"，一改就对不上账）', () => {
  for (const file of [VENDOR_MEASURE, VENDOR_BODYSHAPES]) {
    const raw = fs.readFileSync(file, 'latin1')
    assert.ok(raw.includes('\r\n'), `${path.basename(file)} 里没有 CRLF，说明被人统一过行尾`)
  }
})

// ------------------------------------------------------------
// ② 测量点：与上游逐字、逐序双向对照
// ------------------------------------------------------------

test('20 个测量点与 measurement_sliders.json 的 mod 一字一样、顺序一样（双向，缺一条多一条都红）', () => {
  const upstream = vendorMeasureMods()
  const mine = MEASURE_POINTS.map((p) => p.mhMod)
  assert.strictEqual(MEASURE_POINTS.length, 20)
  assert.strictEqual(upstream.length, 20)
  assert.deepStrictEqual(mine, upstream)
})

test('每个测量点的 en／group 逐字取自上游的 label／分组键；key 与 mhMod 不重复', () => {
  const raw = JSON.parse(fs.readFileSync(VENDOR_MEASURE, 'utf8'))
  const groups = raw.Measure.modifiers
  for (const p of MEASURE_POINTS) {
    const hit = groups[p.group].find((x) => x.mod === p.mhMod)
    assert.ok(hit, `${p.key}：分组 ${p.group} 里查不到 mod ${p.mhMod}`)
    assert.strictEqual(hit.label, p.en, `${p.key}：en 与上游 label 不逐字`)
  }
  assert.strictEqual(new Set(MEASURE_POINTS.map((p) => p.key)).size, MEASURE_POINTS.length)
  assert.strictEqual(new Set(MEASURE_POINTS.map((p) => p.mhMod)).size, MEASURE_POINTS.length)
})

test('分组顺序与上游文件的键序一致，共 9 组', () => {
  const raw = JSON.parse(fs.readFileSync(VENDOR_MEASURE, 'utf8'))
  const upstreamGroups = Object.keys(raw.Measure.modifiers)
  assert.strictEqual(upstreamGroups.length, 9)
  const seen = []
  for (const p of MEASURE_POINTS) if (!seen.includes(p.group)) seen.push(p.group)
  assert.deepStrictEqual(seen, upstreamGroups)
  for (const p of MEASURE_POINTS)
    assert.ok(upstreamGroups.includes(p.group), `${p.key} 的分组不在上游`)
})

// ------------------------------------------------------------
// ③ 体型对照表：14＋8＝22，一条不漏一条不多，且都逐字
// ------------------------------------------------------------

test('对照表 14 条 + 激素型 8 条 = 上游 22 条；mod 与 label 都逐字，且分组各归各', () => {
  const upstream = vendorBodyShapes()
  assert.strictEqual(upstream.length, 22)
  assert.strictEqual(BODY_SHAPE_CROSSWALK.length, 14)
  assert.strictEqual(HORMONE_SHAPE_MODS.length, 8)

  for (const r of BODY_SHAPE_CROSSWALK) {
    const hit = upstream.find((x) => x.mod === r.mod)
    assert.ok(hit, `对照表里的 ${r.mod} 上游没有`)
    assert.strictEqual(hit.label, r.en, `${r.mod}：en 与上游 label 不逐字`)
    assert.ok(
      /body shapes$/.test(hit.group),
      `${r.mod} 不在 body shapes 分组（group=${hit.group}）`,
    )
    assert.ok(r.sex === '女' || r.sex === '男', `${r.mod}：sex 只能是 女/男`)
    assert.ok(
      r.en.includes(r.sex === '女' ? 'Female' : 'Male'),
      `${r.mod}：sex 与上游 label 的性别不符`,
    )
  }
  for (const mod of HORMONE_SHAPE_MODS) {
    const hit = upstream.find((x) => x.mod === mod)
    assert.ok(hit, `激素型登记的 ${mod} 上游没有`)
    assert.ok(/hormonal/.test(hit.group), `${mod} 不在 hormonal components 分组`)
  }
  // 双向：上游 22 条必须被这两张表覆盖完，且两边不许有交集
  const listed = new Set([...BODY_SHAPE_CROSSWALK.map((r) => r.mod), ...HORMONE_SHAPE_MODS])
  assert.strictEqual(listed.size, 22, '对照表与激素型清单有重叠或有重复')
  for (const u of upstream)
    assert.ok(listed.has(u.mod), `上游 ${u.mod} 既没进对照表也没进激素型清单`)
})

test('激素型那 8 条一条都没混进对照表（未检验的体系不发通行证，规范 23 §五）', () => {
  const mods = new Set(BODY_SHAPE_CROSSWALK.map((r) => r.mod))
  const names = BODY_SHAPE_CROSSWALK.map((r) => r.en.toLowerCase())
  for (const mod of HORMONE_SHAPE_MODS) {
    assert.ok(!mods.has(mod), `${mod} 混进了对照表`)
    const tail = mod.split('-').pop()
    assert.ok(
      !names.some((n) => n.includes(tail)),
      `对照表里有名字含 ${tail} 的行——激素型换了名又溜进来了`,
    )
  }
})

// ------------------------------------------------------------
// ④ 结构闸门：这张表只记名字，不给任何数值
// ------------------------------------------------------------

test('测量点行只有 7 个登记字段，全表没有任何数值／阈值键（⛔ 第二把尺子请回来）', () => {
  const allowed = new Set(['key', 'zh', 'en', 'group', 'mhMod', 'column', 'note'])
  for (const p of MEASURE_POINTS) {
    assert.deepStrictEqual(new Set(Object.keys(p)), allowed, `${p.key}：字段不在登记的 7 个里`)
    for (const [k, v] of Object.entries(p)) {
      assert.ok(
        typeof v === 'string' || v === null,
        `${p.key}.${k} 是 ${typeof v}——本表⛔出现数值，界只在 bodyLimits.js`,
      )
    }
  }
  for (const r of BODY_SHAPE_CROSSWALK)
    assert.deepStrictEqual(
      new Set(Object.keys(r)),
      new Set(['mod', 'en', 'zh', 'sex', 'bodyType', 'note']),
    )
  // 模块导出的东西里不许混进界／阈值类的名字
  for (const key of Object.keys(vocab))
    assert.ok(!/limit|min|max|band|threshold/i.test(key), `导出 ${key} 带了数值口径的味道`)
})

test('每个点与每条体型行都写了 note；对不上五档的行必须写明为什么（⛔ 静默 null）', () => {
  for (const p of MEASURE_POINTS) assert.ok(p.note && p.note.length >= 8, `${p.key}：note 太空`)
  for (const r of BODY_SHAPE_CROSSWALK) {
    assert.ok(r.note && r.note.length >= 4, `${r.mod}：note 太空`)
    if (r.bodyType === null)
      assert.ok(r.note.includes('⛔') || r.note.includes('⇒'), `${r.mod}：null 得写理由`)
  }
  for (const c of REPO_COLUMNS_WITHOUT_MH_POINT)
    assert.ok(c.note.length > 8, `${c.column}：note 太空`)
})

// ------------------------------------------------------------
// ⑤ 与站内现状的对齐：列名归 bodyLimits，档名归 bodyTypes
// ------------------------------------------------------------

test('映射了 column 的 4 个点，其列名真的在 bodyLimits.LIMITS 里（尺子只有一份）', () => {
  const mapped = MEASURE_POINTS.filter((p) => p.column)
  assert.strictEqual(mapped.length, 4)
  assert.deepStrictEqual(mapped.map((p) => p.column).sort(), [
    'bust_cm',
    'hip_cm',
    'shoulder_width_cm',
    'waist_cm',
  ])
  for (const p of mapped) assert.ok(LIMITS[p.column], `${p.column} 不在 bodyLimits.LIMITS`)
  for (const c of REPO_COLUMNS_WITHOUT_MH_POINT)
    assert.ok(LIMITS[c.column], `${c.column} 不在 bodyLimits.LIMITS`)
  // 反方向：站内有界但本表没登记的列，必须都在 REPO_COLUMNS_WITHOUT_MH_POINT 里说明过
  const covered = new Set([
    ...mapped.map((p) => p.column),
    ...REPO_COLUMNS_WITHOUT_MH_POINT.map((c) => c.column),
  ])
  assert.strictEqual(covered.size, 8, '映射点与无对应点清单有重叠')
  assert.strictEqual(REPO_COLUMNS_WITHOUT_MH_POINT.length, 4)
  assert.strictEqual(covered.size, Object.keys(LIMITS).length, '本表登记数与 bodyLimits 的列数不等')
  for (const col of Object.keys(LIMITS))
    assert.ok(covered.has(col), `${col}：本表既没当测量点登记，也没列进"无对应点"清单`)
})

test('缺口清单：站内还没有格子的 16 个点，⛔ 与已映射的 4 个混在一起', () => {
  const gaps = measurePointsWithoutRepoColumn()
  assert.strictEqual(gaps.length, 16)
  assert.ok(gaps.every((p) => p.column === null))
  assert.strictEqual(measurePointByColumn('neck_circumference_cm'), null)
  assert.strictEqual(measurePointByColumn(null), null)
  assert.strictEqual(measurePointByColumn(''), null)
  assert.strictEqual(measurePointByColumn('bust_cm').key, 'bust_circumference_cm')
  assert.strictEqual(measurePointByKey('nope'), null)
})

test('对照表里非 null 的 bodyType 只能是 bodyTypes.js 那五档（词表唯一）', () => {
  const used = new Set()
  for (const r of BODY_SHAPE_CROSSWALK) {
    if (r.bodyType === null) continue
    assert.ok(BODY_TYPES.includes(r.bodyType), `${r.mod}：${r.bodyType} 不在五档词表`)
    used.add(r.bodyType)
  }
  // 五档里"倒三角型"必须被覆盖；苹果／沙漏／直筒／梨同理，别让某一档悄悄断链
  assert.deepStrictEqual([...used].sort(), [...BODY_TYPES].sort())
})

test('bodyTypeFromShape：mod 与 label 两种写法都能查到；Diamond／Trapezoid 与认不出的都回 null', () => {
  assert.strictEqual(bodyTypeFromShape('bodyshapes/bodyshapes-elvs-fem-apple'), '苹果型')
  assert.strictEqual(bodyTypeFromShape('Elvs Male Inverted Triangle'), '倒三角型')
  assert.strictEqual(bodyTypeFromShape('bodyshapes/bodyshapes-elvs-fem-rectangle'), '直筒型')
  assert.strictEqual(bodyTypeFromShape('Elvs Female Diamond'), null)
  assert.strictEqual(bodyTypeFromShape('bodyshapes/bodyshapes-elvs-man-trapezoid'), null)
  assert.strictEqual(bodyTypeFromShape('bodyshapes/bodyshapes-elvs-fem-adrenal'), null)
  assert.strictEqual(bodyTypeFromShape('  '), null)
  assert.strictEqual(bodyTypeFromShape(null), null)
  assert.strictEqual(bodyTypeFromShape(undefined), null)
  assert.strictEqual(bodyTypeFromShape('沙漏型'), null, '站内档名不许从这张外来表里绕回来')
  for (const name of [
    'Elvs Female Apple',
    'bodyshapes/bodyshapes-elvs-man-lean-column',
    'nonsense',
  ]) {
    const got = bodyTypeFromShape(name)
    assert.ok(got === null || BODY_TYPES.includes(got))
  }
})

// ------------------------------------------------------------
// ⑥ 这一层不许被接进打分链路：只被自己的消费者 require
// ------------------------------------------------------------

test('本表只被词表自身与单测引用：不进引擎、不进规则匹配、不进顾客表单', () => {
  const root = path.join(__dirname, '..')
  const files = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === 'vendor' || name.startsWith('.')) continue
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.(js|json|ts|tsx)$/.test(name)) files.push(full)
    }
  }
  walk(root)
  const hitters = files.filter((f) => {
    if (f.endsWith('bodyMeasureVocab.js') || f.endsWith('bodyMeasureVocab.test.js')) return false
    return fs.readFileSync(f, 'latin1').includes('bodyMeasureVocab')
  })
  assert.deepStrictEqual(hitters, [], `${hitters.join(', ')} 引用了词表——它⛔参与打分与规则匹配`)
})
