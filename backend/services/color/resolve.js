/**
 * 认色与解析：把自由文案里的色名认出来（元词遮蔽、别名句内扫描、同位置取最长），解析成色值／色相族／明度档。
 * 11-03 大文件拆分轮从 services/colorMetrics.js 切出，代码与注释逐字搬动，行为零变化。
 * §2f 那两张表（COLOR_CRAFT_WORDS／COLOR_ALIAS_SCAN_TOKENS）跟着本模块走：后者的初始化要调下面的 _isColorKey，
 * 靠的是同一模块内的函数声明提升 ⇒ 把它搬去 vocab.js 就变成 require 环。
 * 对外入口仍是 services/colorMetrics.js。
 */

const { ownValue } = require('../../utils/common')
const { hexToLab, ACHROMATIC_C } = require('./base')
const {
  COLOR_NAME_HEX,
  COLOR_SYNONYMS,
  COLOR_FAMILY_WORDS,
  COLOR_FAMILY_OVERRIDES,
  COLOR_HSL_FAMILY_BANDS,
  LIGHTNESS_BANDS,
  LIGHTNESS_TOKENS,
  COLOR_META_WORDS,
  COLOR_META_LONG_KEYS,
} = require('./vocab')

/**
 * 把文字里的元词换成同长度的 `\u0000` 占位：句内扫描既取不到元词本身，
 * 也取不到它肚子里的单字键（「腮红」⇒ `\u0000\u0000\u0000`，那个 红 就没了）。
 * 保持长度不变是为了不改变"谁在句子里出现得最早"这把尺子。
 */
function _maskMetaWords(text) {
  let out = String(text || '')
  for (const { word, keys } of COLOR_META_LONG_KEYS) {
    let from = 0
    for (;;) {
      const i = out.indexOf(word, from)
      if (i < 0) break
      const longHit = keys.find((k) => out.startsWith(k, i))
      if (longHit) {
        from = i + longHit.length // 这一处属于真色名，整条让开
        continue
      }
      out = out.slice(0, i) + '\u0000'.repeat(word.length) + out.slice(i + word.length)
      from = i + word.length
    }
  }
  return out
}

/**
 * 整段输入本身就是元词（带不带尾缀「色」都算）⇒ 它不是一个色名。
 * 现量这条分支不是摆设：`extractColors` 的切分符含「、」，所以 id=302 那句切出来的
 * 那一段正好是「肤色」两个字——**逐段解析的入口也是自由文本来路**，不是手选色名。
 * ⚠️ 手选那条路在本仓没有调用方：前端的肤色那一格给的是冷暖／深浅档（`CustomerForm.tsx:20`
 * ／`PersonalProfileForm.tsx:575`），`COLOR_SYNONYMS` 的键从来不是选择项 ⇒ 这道闸零可用性损失。
 */
function _isMetaWordOnly(s) {
  if (COLOR_META_WORDS.includes(s)) return true
  return s.length > 1 && s.endsWith('色') && COLOR_META_WORDS.includes(s.slice(0, -1))
}

// ------------------------------------------------------------
// 2f. 同义词纳入句内扫描＋工艺词降为弱色（第十三阶段·第一步 §二·1，规范 `21`）
//     改前第 5 步只遍历 232 个表键 ⇒ 42 条别名**只有整段正好等于它时**才命中（第 4 步那条），
//     句子里永远取不到。现量（`21` §〇·3，工装 `phase13-20261021/census-scoped.cjs`）：
//     `extractColors('裸色尖头高跟鞋')` 改前回 `[]`，而 `resolveColor('裸色')` 回 `#EFD9BC`；
//     库里 id=23／33／168／283 四条 `shoe_style` 就这么把裸色丢了。
//     🔴 纳入别名之后的现量面（`phase13-20261021/probe-alias-new.cjs`，本库 1,879 行逐段对比
//     改前改后的句内扫描结果）：**新增 130 个能认出色名的段**，构成（段数）＝
//       牛仔 45／玫瑰 33／珍珠 15／裸色 11／珊瑚 11／橄榄 4／玫瑰色 3／咖啡 3／香槟·象牙·丁香·奶咖·米黄 各 1；
//     落在**四个进分槽位**的是 59 段（`bottom_style` 36／`color_combo` 12／`shoe_style` 9／`top_style` 2），
//     其中 36 段里的绝大多数就是「牛仔裤」这一种写法 ⇒ 见下面那个弱色名单。
//     ⚠️ 「玫瑰 33／珍珠 15／咖啡 3」这三类是同一种毛病（说的是**材质／物件／金属**而不是色），
//     但它们的语料全在 `eye_shadow`／`metal_color`／`necklace_type`／`earring_type`／`hand_pose`
//     这些**不进色彩分**的槽位里（现量：四个进分槽位命中 0 段），本轮不动它们，
//     已列进 `21` §七·1 与 §十二 一起等你裁（要不要连材质词一起降弱色）。
//     ⛔ 弱色只打在**句内扫描**这条来路上：整段就是「牛仔」两个字（衣橱里手填的一格）照旧当具体色，
//     那是人在说颜色，不是文案在说工艺——与 §二·2 那条"手选 vs 自由文案"同一个分界。
// ------------------------------------------------------------

/** 工艺词：字面像色、实际说的是做法（白丹宁也叫牛仔裤）⇒ 句内命中时只记账不进分 */
const COLOR_CRAFT_WORDS = ['牛仔', '水洗', '迷彩']

/**
 * 句内扫描的**别名候选**＝42 条里"自己不是表键、指向的规范键确实在表里"的那些
 * （现量 42/42 全满足；表键与别名撞车的有 0 条，`colorMetrics.test.js` 那条 L3 不变量守着）。
 * ⛔ 不手写名单：从两张表现算，以后加别名不用改这里。
 */
const COLOR_ALIAS_SCAN_TOKENS = Object.keys(COLOR_SYNONYMS).filter(
  (a) => !_isColorKey(a) && _isColorKey(ownValue(COLOR_SYNONYMS, a)),
)

/** 扫到的 token（表键或别名）→ 表内规范键；认不出回 null（⛔ 不回别名） */
function _keyOfScanToken(token) {
  if (typeof token !== 'string') return null
  if (_isColorKey(token)) return token // 本来就是表键
  const target = ownValue(COLOR_SYNONYMS, token)
  return _isColorKey(target) ? target : null
}

/**
 * 从一段结论文本里挑"最先出现在句子里"的**那个词**（表键与别名同一个池子竞争）。
 * 例：'雾霾蓝、灰粉、薰衣草紫衬衫' ⇒ 雾霾蓝
 * 10-20 第六阶段·第一步补了**同位置取最长**这条 tie-break：
 * 表从 58 扩到 232 后出现了 灰／灰色、莫兰迪／莫兰迪粉、藕荷／藕荷色 这类"短键是长键子串"的成对键，
 * 改前两个键都落在位置 0，谁被 `Object.keys` 先枚举到谁赢 ⇒ 同一个输入可能出两个色值。
 * ⚠️ 口径变更（现量）：'基础色上衣（白/黑/灰/藏蓝/米色）' 改前返回 藏蓝（因为 灰 不在表里），
 *    改后返回 **灰**（表里有单字键 灰 了，它位置最靠前）。一条文案多个色本来就该由
 *    `extractColors()` 全列出来，`_firstColorNameIn` 只负责"取句子里第一个能认的"。
 * @returns {string|null}
 */
function _firstColorTokenIn(s) {
  // 元词先打点再扫（§二·2）：三个调用点（`normalizeColorName` 第 5 步／`colorFamily` 兜底／
  // `_matchedColorName` 的标签兜底）都走这一个函数 ⇒ 闸只有这一道，别处不许各写一份。
  const text = _maskMetaWords(String(s || ''))
  let best = null
  let at = Infinity
  // 🔴 第十三阶段·第一步 §二·1：候选池从"232 张表键"扩成"表键＋指向表键的别名"（现量 232＋42）。
  // 同位置撞车照旧**取最长**，不另起尺子：所以「牛仔蓝衬衫」认的是表键 牛仔蓝（3 字），
  // 而不是工艺别名 牛仔（2 字）；「水洗蓝」同理不会被 水洗 抢走。
  for (const k of Object.keys(COLOR_NAME_HEX)) {
    const i = text.indexOf(k)
    if (i < 0) continue
    if (i < at || (i === at && best !== null && k.length > best.length)) {
      at = i
      best = k
    }
  }
  for (const a of COLOR_ALIAS_SCAN_TOKENS) {
    const i = text.indexOf(a)
    if (i < 0) continue
    if (i < at || (i === at && best !== null && a.length > best.length)) {
      at = i
      best = a
    }
  }
  return best
}

/** 句内扫描的对外口径：**回表内规范键**（别名要先折成规范键再交出去，⛔ 别让下游索引不到） */
function _firstColorNameIn(s) {
  return _keyOfScanToken(_firstColorTokenIn(s))
}

/** 表里是否真有这个键（并且值是 '#RRGGBB' 字符串）——不碰原型链 */
function _isColorKey(k) {
  return (
    typeof k === 'string' &&
    Object.prototype.hasOwnProperty.call(COLOR_NAME_HEX, k) &&
    typeof COLOR_NAME_HEX[k] === 'string'
  )
}

/**
 * L2 词形归一：把"口语写法的色名"折回词表规范键。
 * 五步，**按顺序**，任何一步命中就返回；全落空返回 null（不猜）。
 *   1 精确命中表键
 *   2 去尾「色」：雾霾蓝色→雾霾蓝、卡其色→卡其、大红色→大红
 *   3 补尾「色」：卡其→卡其色（表里有 22 个键本身就带「色」，如 蜜桃色/鹅黄色/西柚色）
 *   4 同义词库：咖啡色→咖啡棕、裸色→奶杏色、松石绿→绿松石（见 COLOR_SYNONYMS 三条不变量）
 *   5 句内扫描：'驼色大衣'→驼色、'穿雾霾蓝更显白'→雾霾蓝
 *      🔴 第十三阶段·第一步 §二·1：这一步的候选池从 232 张表键扩成"表键＋42 条别名"，
 *      所以 '裸色尖头高跟鞋'→奶杏色 这种写法从本轮起认得出（改前回 null）。
 *      ⚠️ 返回的**永远是表内规范键**，别名要先折成规范键（下游拿它索引 `COLOR_NAME_HEX`）。
 * ⛔ 第 0 步是元词闸（§二·2）：整段就是「肤色／肉色／腮红」直接认不出，走不到第 4 步。
 * @param {string} input 色名或一段文案
 * @returns {null|string} 词表规范键；认不出返回 null
 */
function normalizeColorName(input) {
  if (input === null || input === undefined) return null
  const s = String(input).trim()
  if (!s) return null
  // 元词闸（§二·2）：整段就是「肤色／肉色／腮红」（带不带尾缀「色」都算）⇒ 认不出。
  // ⛔ 这条必须挡在第 4 步同义词之前：`COLOR_SYNONYMS` 里 `肤色→奶杏色`、`肉色→奶杏色`、
  // `腮红→腮红粉` 三条键**保留**（将来手选色名那条路还在），但自由文案不许走进去。
  if (_isMetaWordOnly(s)) return null
  if (_isColorKey(s)) return s
  if (s.length > 1 && s.endsWith('色') && _isColorKey(s.slice(0, -1))) return s.slice(0, -1)
  if (_isColorKey(`${s}色`)) return `${s}色`
  const syn = ownValue(COLOR_SYNONYMS, s)
  if (syn && _isColorKey(syn)) return syn
  if (s.length > 1 && s.endsWith('色')) {
    const syn2 = ownValue(COLOR_SYNONYMS, s.slice(0, -1))
    if (syn2 && _isColorKey(syn2)) return syn2
  }
  const hit = _firstColorNameIn(s)
  return hit || null
}

/** '#RRGGBB' 认得上限；与 resolveColor 的老口径一致（只收 6 位 hex） */
const _HEX6 = /^#?[0-9a-fA-F]{6}$/

/**
 * 统一取色入口：给出 hex **和它是凭什么认出来的**（审计字段 basis）。
 * basis 取值：'hex'（本来就是色值）／'table-key'（精确键）／'strip-color'（去尾色）／
 * 'add-color'（补尾色）／'synonym'（整段就是别名，走同义词库）／
 * 'in-text'（句内扫描扫到表键）／'synonym-in-text'（第十三阶段·第一步 §二·1：句内扫描扫到别名）
 * ／null（认不出）。
 * `craft`（§二·1）：这一色值是**句内**扫出来的工艺词（牛仔／水洗／迷彩）⇒ true，
 * 调用方按"提到了一个色、但不是具体色"处理（⛔ 不进 ΔE00、⛔ 不进呼应）。
 * 整段就是「牛仔」那一格（衣橱里手填的色名）**不算** craft：那是人在说颜色，不是文案在说工艺。
 * @returns {{key:string|null, hex:string|null, lab:object|null, basis:string|null, via:string|null, craft:boolean}}
 */
function _resolveDetailed(input) {
  const none = { key: null, hex: null, lab: null, basis: null, via: null, craft: false }
  if (input === null || input === undefined) return none
  const s = String(input).trim()
  if (!s) return none
  if (_HEX6.test(s)) {
    const hex = `#${s.replace(/^#/, '').toUpperCase()}` // 统一大写，前端拿到的是稳定值
    const lab = hexToLab(hex)
    return lab ? { key: null, hex, lab, basis: 'hex', via: null, craft: false } : none
  }
  const key = normalizeColorName(s)
  if (!key) return none
  // 词表只认自己的色名：写成 COLOR_NAME_HEX[s] 时 s='constructor' 会返回 Object 构造器，
  // 这个"颜色"再往下走就成了函数而不是 '#RRGGBB'，最后 hexToLab 认不出、分数无声消失
  const hex = ownValue(COLOR_NAME_HEX, key)
  if (typeof hex !== 'string') return none
  const lab = hexToLab(hex)
  if (!lab) return none
  // basis 记的是"第几步中的"，同义那条把走过的别名也记下来，前台要显示"按同义词认成 X"时有据可查
  let basis = 'table-key'
  let via = null
  if (key !== s) {
    if (s.length > 1 && s.endsWith('色') && s.slice(0, -1) === key) basis = 'strip-color'
    else if (`${s}色` === key) basis = 'add-color'
    else if (
      ownValue(COLOR_SYNONYMS, s) === key ||
      ownValue(COLOR_SYNONYMS, s.replace(/色$/, '')) === key
    ) {
      basis = 'synonym'
      via = s
    } else {
      // 🔴 §二·1：句内扫到的这个词本身是不是别名 ⇒ 出处要分开记，
      // 「裸色高跟鞋」和「裸色」这两条来路在前台是两句话（一个靠读句子，一个是用户写的原词）。
      const token = _firstColorTokenIn(s)
      if (token && token !== key && ownValue(COLOR_SYNONYMS, token) === key) {
        basis = 'synonym-in-text'
        via = token
      } else basis = 'in-text'
    }
  }
  // 工艺词只在**句内**那一条来路上降弱色（上面那个 `else` 分支才会给 basis='synonym-in-text'）
  const craft = basis === 'synonym-in-text' && COLOR_CRAFT_WORDS.includes(via)
  return { key, hex, lab, basis, via, craft }
}

/** 接受 '#hex' / 'hex' / 色名 / 含色名的文案；识别不了返回 null（调用方必须"缺色不出分"，不许猜） */
function resolveColor(input) {
  return _resolveDetailed(input).hex
}

/** sRGB hex → HSL 色相角（0~360）；无彩色（r=g=b）返回 null。L4 分族兜底用，不参与任何色差 */
function _hslHue(hex) {
  const m = String(hex || '')
    .replace(/^#/, '')
    .match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  if (d === 0) return null
  let h
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

/**
 * L4 色系软标签：色名（或文案／hex）→ 红/橙/黄/绿/青/蓝/紫/粉/棕/无彩色。
 * 判据顺序＝族字（名字里位置最靠后的那个）→ 覆写表 → HSL 角兜底，见 §2c 那段现量。
 * ⛔ 这个标签**不进 ΔE00、不进任何分数**，只用于分组与文案；
 *    它跟 Schloss & Palmer 那条"色相差"没有任何关系，别拿它解释贴合分。
 * @returns {null|string}
 */
function colorFamily(input) {
  const d = _resolveDetailed(input)
  const key = d.key || _firstColorNameIn(String(input || ''))
  if (!key) return null
  const ov = ownValue(COLOR_FAMILY_OVERRIDES, key)
  if (ov) return ov
  const s = String(key)
  let best = null
  let at = -1
  for (const [w, f] of COLOR_FAMILY_WORDS) {
    const i = s.lastIndexOf(w)
    if (i > at) {
      at = i
      best = f
    }
  }
  if (best) return best
  // 名字里没有族字 ⇒ 先用本模块自己那条无彩色线判（C<ACHROMATIC_C），再退回 HSL 角。
  // 这一句是必需的：石墨色 #4A4C4F、蛋壳色 #EFEDE3 的 C 只有 2.7／5.2，
  // 按 HSL 角算会得到 蓝／黄（r≠g≠b 就有色相角），但它们本来就没有色相。
  const labForCheck = d.lab || hexToLab(ownValue(COLOR_NAME_HEX, key))
  if (labForCheck && labForCheck.C < ACHROMATIC_C) return '无彩色'
  // 还是没有 ⇒ 才用 HSL 角兜底
  const hue = _hslHue(d.hex || ownValue(COLOR_NAME_HEX, key))
  if (hue === null) return '无彩色'
  for (const band of COLOR_HSL_FAMILY_BANDS) {
    const ok =
      band.from < band.to ? hue >= band.from && hue < band.to : hue >= band.from || hue < band.to
    if (!ok) continue
    return band.family
  }
  return '其他'
}

/** 文案里最靠前的明度词原词（深色／浅色系／亮色…）；没有返回 null。via 字段要显示它
 *  同位置撞车时取**最长**的那个：'深色系' 里 深色 与 深色系 都落在位置 0，
 *  按 `Object.keys` 顺序谁先枚举谁赢 ⇒ 同一个输入可能回两个不同原词（与 _firstColorNameIn 同一个坑，同一把尺子修）。
 */
function _bandTokenIn(text) {
  const s = String(text || '')
  let best = null
  let at = Infinity
  for (const k of Object.keys(LIGHTNESS_TOKENS)) {
    const i = s.indexOf(k)
    if (i < 0 || i > at) continue
    if (i < at || k.length > String(best).length) {
      at = i
      best = k
    }
  }
  return best
}

/** 明度词 → 档（'深'|'中'|'浅'）；没有明度词返回 null */
function _bandOfText(text) {
  const t = _bandTokenIn(text)
  return t ? LIGHTNESS_TOKENS[t] : null
}

/** 已知 Lab → 明度档（语义切点 L≤35 深／L≥65 浅，见 §2d 的 33/88/111 现量） */
function bandOfLab(lab) {
  if (!lab || !Number.isFinite(lab.L)) return null
  if (lab.L <= LIGHTNESS_BANDS['深'].lMax) return '深'
  if (lab.L >= LIGHTNESS_BANDS['浅'].lMin) return '浅'
  return '中'
}

/**
 * L5 对外入口：给色名／文案／hex，回它属于哪一档明度。
 * 先按取到的具体色算 L，取不到色值才退回文案里的明度词（「深色上衣」这种）。
 * ⚠️ 10-20 第六阶段·第一步修口：退回文案那条分支改前回的是**原词**（'深色'），
 *    与 `@returns` 约定的档名（'深'）不是同一个词，调用方拿它去索引 `LIGHTNESS_BANDS` 会取到 undefined。
 * @returns {null|'深'|'中'|'浅'}
 */
function lightnessBand(input) {
  const d = _resolveDetailed(input)
  if (d.lab) return bandOfLab(d.lab)
  return _bandOfText(String(input || ''))
}

/**
 * 自由文本抽色（第六阶段·第一步的核心件）。
 * 「雾霾蓝＋白色针织」「深灰/藏青西裤」「上白下黑」这类一条文案多个色的写法，
 * `_firstColorNameIn` 只能取第一个，这一层把**全部**能认的色都列出来。
 * 切分符现量依据（docs/依据/14 §1.2 与 phase6-20261020/color-word-census.cjs）：
 * 语料里多色写法用的就是 `+ ＋ 、 ， , / ／ 空格 和 与 或`。
 * @param {string} text 结论文本／衣橱色名／配色串
 * @returns {Array<{text:string,label:string|null,hex:string|null,lab:object|null,family:string|null,band:string|null,is_specific:boolean,craft_word:boolean,basis:string|null,via:string|null}>}
 *          认不出任何一段就回空数组（调用方按"这一维没数据"处理，不许当 0 分）
 */
function extractColors(text) {
  const s = String(text || '')
  if (!s.trim()) return []
  const parts = s
    .split(/[+＋、,，;；/／\s]|和|与|或/g)
    .map((p) => p.trim())
    .filter(Boolean)
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const d = _resolveDetailed(p)
    const family = d.key ? colorFamily(p) : null
    const band = d.lab ? bandOfLab(d.lab) : _bandOfText(p)
    if (d.hex) {
      if (seen.has(d.hex)) continue
      seen.add(d.hex)
      out.push({
        text: p,
        label: d.key,
        hex: d.hex,
        lab: d.lab,
        family,
        band,
        // 🔴 §二·1：句内扫出来的工艺词（牛仔裤／水洗布／迷彩服）记 `is_specific:false`——
        // 这个字提的是做法不是颜色（白丹宁也叫牛仔裤），拿它算 ΔE00 就是喂假数。
        // 与明度档同一级：`recommendEngine.js:75` 那个 `is_specific && hex` 的 filter 自动把它挡在呼应外。
        is_specific: !d.craft,
        craft_word: !!d.craft,
        basis: d.basis,
        via: d.via,
      })
    } else if (band) {
      // 没有具体色、只有"深/浅"这一档 ⇒ 也进列表，但 is_specific=false，
      // 调用方必须知道这是一档亮度而不是一个颜色（不许拿它算 ΔE00）
      if (seen.has(`band:${band}:${p}`)) continue
      seen.add(`band:${band}:${p}`)
      out.push({
        text: p,
        label: LIGHTNESS_BANDS[band].label,
        hex: null,
        lab: null,
        family: null,
        band,
        is_specific: false,
        craft_word: false,
        basis: 'lightness-band',
        via: p,
      })
    }
  }
  // 整串没切开（单段）但里面有明度词时，上面那条分支已经处理；
  // 这里补的是"整串一个色都认不出、却含明度词"的情况：'深色上衣显气场'
  // ⚠️ 10-20 第六阶段·第一步修口：这里原先写 `_bandTokenIn(s)`，回的是原词 '深色'，
  //    下一行 `LIGHTNESS_BANDS[band].label` 会取到 undefined 当场抛 TypeError。
  //    现量口径：这段今天打不到（分隔符切出来的每一段都是整串的子串，整串含明度词 ⇒ 必有一段含），
  //    但它是个埋着的雷——谁把切分规则放宽一次就会炸，所以按 _bandOfText 走档名。
  if (!out.length) {
    const band = _bandOfText(s)
    if (band) {
      out.push({
        text: s.slice(0, 24),
        label: LIGHTNESS_BANDS[band].label,
        hex: null,
        lab: null,
        family: null,
        band,
        is_specific: false,
        craft_word: false,
        basis: 'lightness-band',
        via: null,
      })
    }
  }
  return out
}

module.exports = {
  COLOR_CRAFT_WORDS,
  COLOR_ALIAS_SCAN_TOKENS,
  _firstColorNameIn,
  normalizeColorName,
  _resolveDetailed,
  resolveColor,
  colorFamily,
  _bandTokenIn,
  _bandOfText,
  bandOfLab,
  lightnessBand,
  extractColors,
}
