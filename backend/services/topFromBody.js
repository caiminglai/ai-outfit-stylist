/**
 * 上衣处方：给一个人（身材尺寸 + 肤色），输出"上衣该选成什么样"
 * ============================================================
 *
 * 与 topFitBody.js 的分工：
 *  - topFitBody  = 有了一件上衣（衣柜一行 / 规则结论一句话）⇒ 判它修得对不对，出分
 *  - topFromBody = 手上没有衣服 ⇒ 只按这个人的身体与肤色，出一张"该选什么"的规格表
 * 这个模块不读衣橱、不做缺口分析、不给购物建议，输入只有档案字段；缺测的维度整条不出。
 *
 * 10-09 定案的三层顺序（用户口径："上衣首先是合身……其次是服装和肤色的问题"）：
 *  第 0 层 合身 = `fitSize.fitLayer()` ⇒ GB/T 1335 号型（号/型/Y·A·B·C）+ 四道部位判据；
 *  第 1 层 修形 = 本文件的 `axes`（六轴 want 向量，显不显瘦那一类）；
 *  第 2 层 颜色 = 本文件的 `colour`（与肤色锚点的色差排序）。
 *  ⚠️ **第 0 层与第 1 层是两套结论，允许互相反对，任何地方都不许把它们平均成一个分数。**
 *  合身层的输入输出、档位与措辞边界以 `docs/依据/09-合身层输入输出规范.md` 为准。
 *
 * 先说清楚没有的东西（措辞红线，见 docs/依据/05、06）：
 *  - 国内国外都**没有**任何国标／行标／学会标准规定"某人穿某件上衣好不好看"。
 *  - 能搬过来的只有：① 色差公式（A 档，GB/T 7921-2008／ISO-CIE 11664）；
 *    ② 若干"方向"级实证（B 档：肩宽侧更被偏好、松量-被评体宽、深色收缩、衣装明度对脸的对比效应）；
 *    ③ 行业体系的款式经验词（C 档：垫肩显肩、竖条显瘦之类）；
 *    ④ 本模块自己的**刻度、阈值、权重、款式词表**（C 档手拍，标定中）。
 *  ⇒ 所以每条处方都带 tier，对外不许说成"科学结论"，只许说"按 X 方向 + 我们的经验刻度"。
 *
 * 档位与出处（DOI 已于 10-08/10-09 逐条走 api.crossref.org 自核，记录在 docs/依据/06）：
 *  shoulder 方向 B —— Pazhoohi 2023, DOI 10.1007/s10508-023-02610-w（该文的 SHR＝肩围÷臀围；我们用不到肩围，
 *           肩宽÷身高与肩宽÷腰围两根比值都只是借方向，带与刻度是 C 档手拍）
 *  waist    方向 B− —— 腰线/腰臀研究被 BMI 混淆（Singh 系与后续反驳，见 02）
 *  ease     方向 B —— Liu/Fan/Lau 2006, DOI 10.2466/pms.103.1.253-264；区间 B− —— Sakata 2020, DOI 10.1108/ijcst-03-2020-0031
 *  length   方向未闭合 B− —— Kiire 2016 与 Versluys 2018 结论相反
 *  volume   方向 B —— Koutsoumpis 2021, DOI 10.1177/03010066211038158（深色收缩，d=0.35~0.58）
 *  pattern  B 但文献互相冲突（Thompson&Mikellidou 2011 / Swami&Harris 2012 / Ashida 2013 / Chen&Peng 2026）⇒ 低权重 + BMI 闸门
 *  colour   A 公式 + B 方向（Schloss & Palmer 2011 PMC3037488 图形色-背景那句；Zhang 2025, DOI 10.1111/cote.12828）+ C 权重
 */

const { bodyDeviation, BODY_REF, AXIS_CN, AXIS_TIER } = require('./topFitBody')
const { fitLayer } = require('./fitSize')
const { colorFit, skinToneToLab, synthesizeSkinLab, COLOR_NAME_HEX } = require('./colorMetrics')

/** |want| 小于这个数就当"这一维不推拉"，不给方向性建议（C 档手拍阈值） */
const NEUTRAL_BAND = 0.15

/** 每根轴的方向句 + 该选的款式特征 / 该避的款式特征（词表是 C 档行业经验，不是标准） */
const SPEC = {
  shoulder: {
    tier: '方向 B（Pazhoohi 2023 肩宽侧更被偏好；该文量的是肩围÷臀围）／参考带与款式词 C 档手拍',
    plus: {
      label: '把肩线做出来',
      prefer: [
        '正肩线（肩缝落在肩点）',
        '轻微垫肩或袖山有支撑',
        '一字领／船领／方领',
        '袖笼不滑落',
      ],
      avoid: ['落肩', '插肩 raglan', '细吊带', '领口宽到肩头以内'],
    },
    minus: {
      label: '别让肩再加宽',
      prefer: ['插肩／落肩（肩缝内收）', 'V 领把视线往中线拉', '肩头无装饰、无垫肩'],
      avoid: ['垫肩', '泡泡袖／羊腿袖', '一字领／船领', '肩部口袋与横向拼接线'],
    },
    neutral: '肩上的几条比值合出来接近 0 ⇒ 这一维不推拉，按场合和喜好选就行',
  },
  waist: {
    tier: '方向 B−（腰线研究被 BMI 混淆）／落差刻度与款式词 C 档手拍',
    plus: {
      label: '腰线明显 ⇒ 顺着身体把它做出来',
      prefer: [
        '收腰／束腰剪裁',
        '腰线缝线落在自然腰（肚脐上方一指）',
        '上衣塞一角或短款到腰线',
        'X 型外搭系带',
      ],
      avoid: ['从上到下一样宽的直筒', 'oversize 盖住腰', '腰线缝线落在 hip 骨以下'],
    },
    minus: {
      label: '腰线偏平 ⇒ 别硬收，把线做在你想让人看的位置',
      prefer: [
        'H 型／微直筒',
        '不强调腰线的合体剪裁',
        '要提腰就整件上移（高腰＋短款），别只在中间勒一道',
      ],
      avoid: ['硬束腰／宽腰封', '在腰线处加抽绳、松紧带', '收腰缝线配厚面料（勒出不存在的折痕）'],
    },
    neutral: '腰沟接近参考中位 ⇒ 这一维不推拉，收不收都行',
  },
  ease: {
    tier: '方向 B（Liu 2006 松量影响被评体宽）／合适区间 B−（Sakata 2020）／cm→款式 C 档',
    plus: null,
    minus: null,
    neutral: null,
  },
  length: {
    tier: '方向未闭合 B−（Kiire 2016 与 Versluys 2018 相反）⇒ 阈值属产品假设／款式词 C 档',
    plus: {
      label: '腿身比偏短 ⇒ 把视觉腰位往上提',
      prefer: ['衣长落在腰线（短款）', '前襟塞一角', '下摆不收口或收在高处'],
      avoid: ['下摆过胯、盖住臀', '长款直筒', '下摆横向条纹／滚边'],
    },
    minus: {
      label: '腿身比偏长 ⇒ 上衣可以往下放，别把腰线顶得太高',
      prefer: ['盖到胯骨的中长款', '下摆在胯线附近收口', '低一格的腰线位置'],
      avoid: ['超短款露腰', '高腰到肋骨下缘', '下摆在腰线以上'],
    },
    neutral: '腿身比在参考带内 ⇒ 这一维不推拉，衣长随意',
  },
  volume: {
    tier: '方向 B（Koutsoumpis 2021 深色收缩，d=0.35~0.58）／厚薄与面料词 C 档',
    plus: {
      label: '想加一点体量 ⇒ 往"蓬、亮、厚"方向走',
      prefer: ['浅色系（明度 L* 高）', '有厚度的针织／呢料', '光泽面料', '层叠、荷叶边、大口袋'],
      avoid: ['贴身薄针织', '哑光深色', '单层极简'],
    },
    minus: {
      label: '想收一点体量 ⇒ 往"深、哑、顺"方向走',
      prefer: ['深色（L* 低）', '哑光、垂坠面料', '单层无装饰', '顺身剪裁'],
      avoid: ['亮面／金属感', '厚呢、粗针大毛线', '大面积印花与堆叠装饰', '横向拼接线'],
    },
    neutral: 'BMI 在中间带 ⇒ 这一维不推拉，深浅厚薄都行',
  },
  pattern: {
    tier: 'B 档但文献结论互相冲突（4 篇方向不一）⇒ 只当低权重修正，不许当判定',
    // 文案方向必须跟打分一致，否则顾客看到的理由和推荐排序是两回事：
    // describeTop 读的条纹取值表 topFitBody.js:389（竖条=+1、横条=-1），落到轴上是 `:594`；want.pattern
    // 直接取 want.volume（`:337`）⇒ 想加体量（want>0）的人被抬高的是**竖条**，想收（want<0）
    // 的是**横条**。原来这两句 label 把目标说反（plus 写"你想收窄时…选竖向"），
    // 而 plus 分支只会落在偏瘦的人身上（BMI<24 ⇒ want.volume>0），报告当场自相矛盾。
    plus: {
      label:
        '想显得饱满一点 ⇒ 可用竖条（方向取自 Koutsoumpis 配对任务，与常见说法相反，只是低权重修正）',
      prefer: ['细竖条（条宽窄、间距密）', '竖向拼接线'],
      avoid: ['横条（尤其在大面积、浅色、宽条时）', '大格与横向拼接线'],
    },
    minus: {
      label: '想收一点 ⇒ 可用横条（同一篇文献的配对结果，BMI 一到 25 这条就不再采用）',
      prefer: ['横条／宽间距条', '大尺度图案'],
      avoid: ['密细竖条'],
    },
    neutral: '这一维不推拉 ⇒ 条纹横竖都随喜好，我们不拿它当理由',
  },
}

/** 颜色候选一次给几条 */
const COLOR_TOP_N = 6
const COLOR_AVOID_N = 3

function tierOf(axisKey) {
  return AXIS_TIER[axisKey] || 'C'
}

/** want 落在哪一侧：null=没量；0.0=不推拉；+1/-1=方向 */
function sideOf(want) {
  if (want == null) return null
  if (Math.abs(want) < NEUTRAL_BAND) return 0
  return want > 0 ? 1 : -1
}

/**
 * 六轴规格。每轴只在"这个人量得出"的时候出条目；不推拉的轴也出，但只说一句"这一维不推拉"。
 * @param {object} person 已 enrich 的档案
 * @param {object} dev bodyDeviation 的结果
 */
function axisSpecs(person, dev) {
  const out = []
  const miss = []

  for (const key of ['shoulder', 'waist', 'ease', 'length', 'volume', 'pattern']) {
    const want = key === 'ease' ? null : dev.want[key]
    const spec = SPEC[key]

    if (key === 'ease') {
      if (!dev.ease_window) {
        miss.push({ key, name_cn: AXIS_CN.ease, reason: '身高体重没量 ⇒ BMI 算不出，松量窗口不给' })
        continue
      }
      const [lo, hi] = dev.ease_window
      const bustNum = Number(person.bust)
      const hasBust = Number.isFinite(bustNum) && bustNum > 0
      const targetBust = hasBust
        ? `${Math.round((bustNum + lo) * 10) / 10}~${Math.round((bustNum + hi) * 10) / 10} cm`
        : null
      out.push({
        key,
        name_cn: AXIS_CN.ease,
        want: null,
        side: 'window',
        tier: spec.tier,
        label: `上衣胸围松量落在 ${lo}~${hi} cm`,
        prefer: [
          `选到号后胸围比你的净胸围大 ${lo}~${hi} cm 的那一档`,
          targetBust ? `换算成成衣胸围≈ ${targetBust}` : '净胸围没量 ⇒ 只给松量区间，不给成衣尺寸',
          '别用"大一码更宽松"或"小一码更修身"绕开这个区间',
        ],
        avoid: [
          `胸围松量小于 ${lo} cm（贴着皮肤走，Liu 2006 里过紧也被评更胖）`,
          `胸围松量大于 ${hi} cm（廓形把身形放大）`,
        ],
        based_on: dev.notes.filter((n) => n.includes('松量')).join('；'),
      })
      continue
    }

    const side = sideOf(want)
    if (side === null) {
      // 条纹那一维的 null 有两种：BMI<25 且方向接近 0（真不推拉）vs BMI≥25 被闸门关掉（我们拒绝用）
      // 后者绝不能包装成"这一维不推拉"，那是把"不敢用"说成"不用改"
      if (
        key === 'pattern' &&
        dev.measure.bmi != null &&
        dev.measure.bmi >= BODY_REF.stripe_bmi_max
      ) {
        miss.push({
          key,
          name_cn: AXIS_CN.pattern,
          reason: `BMI ${dev.measure.bmi} ≥ ${BODY_REF.stripe_bmi_max} ⇒ 这条我们不用（四篇文献方向互相冲突，只在偏瘦区间当低权重修正）`,
        })
        continue
      }
      // want 是 null 有两种完全不同的情况：没量 vs 量了但落在参考带内（不推拉）
      // 前一种进 missing，后一种照样出一条"这一维不推拉"，别让顾客以为我们没算
      if (measurePresent(key, dev)) {
        out.push({
          key,
          name_cn: AXIS_CN[key],
          want: 0,
          side: 0,
          tier: spec.tier,
          label: spec.neutral || '这一维落在参考带内 ⇒ 不推拉',
          prefer: [],
          avoid: [],
          based_on: basedOn(key, dev),
        })
      } else {
        miss.push({ key, name_cn: AXIS_CN[key], reason: missingReason(key, dev) })
      }
      continue
    }
    if (key === 'pattern') {
      if (side === 0) {
        out.push({
          key,
          name_cn: AXIS_CN.pattern,
          want,
          side: 0,
          tier: spec.tier,
          label: SPEC.pattern.neutral,
          prefer: [],
          avoid: [],
          based_on: basedOn(key, dev),
        })
        continue
      }
      out.push(
        specRow(key, want, side, spec, dev, { gated: 'BMI<25 才用这一条；文献本身结论不一致' }),
      )
      continue
    }
    if (side === 0) {
      out.push({
        key,
        name_cn: AXIS_CN[key],
        want,
        side: 0,
        tier: spec.tier,
        label: spec.neutral,
        prefer: [],
        avoid: [],
        based_on: basedOn(key, dev),
      })
      continue
    }
    out.push(specRow(key, want, side, spec, dev))
  }
  return { axes: out, missing: miss }
}

function specRow(key, want, side, spec, dev, extra) {
  const branch = side > 0 ? spec.plus : spec.minus
  const row = {
    key,
    name_cn: AXIS_CN[key],
    want,
    side,
    tier: spec.tier,
    label: branch.label,
    prefer: branch.prefer,
    avoid: branch.avoid,
    based_on: basedOn(key, dev),
  }
  if (extra) Object.assign(row, extra)
  return row
}

/** 这条是按哪个实测数推出来的（顾客要能追到"凭什么"） */
function basedOn(key, dev) {
  const m = (dev && dev.measure) || {}
  switch (key) {
    case 'shoulder': {
      const parts = []
      if (m.shoulder_ratio != null) {
        // 带宽从 BODY_REF.shoulder_band 取，别再抄一遍 21/24 的字面量：
        // 上面那个常量一改，这句"参考带 21~24%"就会变成一句对着旧带说的假话
        const [lo, hi] = BODY_REF.shoulder_band
        const inBand = m.shoulder_ratio >= lo && m.shoulder_ratio <= hi
        parts.push(
          `肩宽÷身高 = ${m.shoulder_ratio}%（参考带 ${lo}~${hi}%${inBand ? '，在带内' : ''}）`,
        )
      }
      if (m.shoulder_waist_ratio != null) {
        const [lo, hi] = BODY_REF.shr_band
        const inBand = m.shoulder_waist_ratio >= lo && m.shoulder_waist_ratio <= hi
        parts.push(
          `肩宽÷腰围 = ${m.shoulder_waist_ratio}（站内比值，参考带 ${lo}~${hi}${inBand ? '，在带内' : ''}；不是论文那个肩围÷臀围）`,
        )
      }
      if (m.bust_hip_diff != null)
        parts.push(
          `胸围−臀围 = ${m.bust_hip_diff} cm${m.bust_hip_diff < 0 ? '（下身比上身宽 ⇒ 往加肩修）' : ''}`,
        )
      return parts.join('；')
    }
    case 'waist': {
      if (m.waist_groove_cm == null) return ''
      const partial = ((dev && dev.notes) || []).some((n) => n.includes('只用臀腰差算'))
      return partial
        ? `腰沟 = ${m.waist_groove_cm} cm（胸围没量，只用臀腰差算 ⇒ 证据面窄一半）`
        : `腰沟（胸腰差与臀腰差里小的那个）= ${m.waist_groove_cm} cm`
    }
    case 'length':
      return m.leg_ratio != null ? `腿身比 = ${m.leg_ratio}（参考带 0.52~0.56）` : ''
    case 'volume':
      return m.bmi != null ? `BMI = ${m.bmi}` : ''
    case 'pattern':
      return m.bmi != null ? `BMI = ${m.bmi}（闸门：只在 <25 时用）` : ''
    default:
      return ''
  }
}

/** 这一维需要的实测数在不在场（在＝算过只是落在带内；不在＝真没量） */
function measurePresent(key, dev) {
  const m = (dev && dev.measure) || {}
  if (key === 'shoulder')
    return m.shoulder_ratio != null || m.shoulder_waist_ratio != null || m.bust_hip_diff != null
  if (key === 'waist') return m.waist_groove_cm != null
  if (key === 'length') return m.leg_ratio != null
  if (key === 'volume') return m.bmi != null
  if (key === 'pattern') return m.bmi != null
  return false
}

function missingReason(key, dev) {
  const m = (dev && dev.measure) || {}
  if (key === 'shoulder')
    return m.shoulder_ratio == null && m.shoulder_waist_ratio == null
      ? '肩宽没量 ⇒ 肩宽÷身高与肩宽÷腰围都算不出'
      : '臀胸差也没量'
  if (key === 'waist') return '胸围／腰围／臀围没量齐 ⇒ 腰沟算不出'
  if (key === 'length') return m.leg_ratio == null ? '腿长（或身高）没量 ⇒ 腿身比算不出' : ''
  if (key === 'volume') return m.bmi == null ? '身高体重没量 ⇒ BMI 算不出' : ''
  if (key === 'pattern')
    return m.bmi == null ? '没量 BMI ⇒ 闸门无法判' : 'BMI≥25 ⇒ 闸门关闭，这条不采用'
  return '没量'
}

/**
 * 上衣 × 肤色 的颜色候选：不吃脸型五官，只吃肤色这几档 Lab 锚点。
 * 没有可靠肤色 ⇒ 整段不出（不猜）。
 *
 * 肤色有两个口径：冷暖（冷皮/暖皮/自然，主要影响色相差）与深浅（白皙~古铜色，L\* 跨度
 * 30，直接决定"衣装越暗脸越显白"那一项）。档案里 skin_tone 可能被 enricher 用深浅值回填过
 * ⇒ 深浅词表在前、冷暖词表在后，按取到的值归类，不按字段名猜。两个口径都能认时按**更低的
 * 那个分**排：只讨好一个口径的颜色不许排前面（宁可保守，不吹）。
 *
 * 🔴 10-21 补（第十阶段·第一步，docs/依据/18 §2.5 与 §九）：这个函数原来是**第五处**自己拼
 * 肤色字符串的取值点（改前 `:379` 一行 `skinToneToLab(value)`，完全不看 `skin_hue`），
 * 现象实测在盘外工装 `api-diff.cjs`：照片角度改了 Top-8 名次，却**没改顾客看到的这串建议色**。
 * 现在两处（引擎的 `_skinForColor`、这里的 `colorSpec`）都调同一个 `synthesizeSkinLab`，
 * 过不了闸（非有限数／越过 h 闸／深浅冷暖两格都没填）⇒ 整段回改前行为，⛔ 不编值。
 *
 * ⚠️ 照片顶掉的是**冷暖那一格**，不是"传进来的那一个档"。判据＝h° 这个量本身就是冷暖轴
 * （`synthesizeSkinLab` 回的 `undertone` 正是 冷皮/自然/暖皮 三个词），而深浅轴是 L\*——
 * 本站明确不吃照片的绝对明度。第一版写成"顶掉 toneText 那一档"，实测在 自然白／自然 这个人身上
 * 建议色六个分逐字没动（盘外 `api-diff.cjs` 10-21：`A==B true`），因为取低分时瓶颈全在冷暖那颗；
 * 顶错格子＝照片又被瓶颈吃掉了，等于没接。深浅锚点无论如何在下面原样保留。
 */
const DEEP_WORDS = ['白皙', '自然白', '偏黄', '小麦色', '古铜色']
/** 冷暖口径那三个词（`SKIN_TONE_ANCHORS` 里的冷暖侧；照片接管的就是这一格） */
const UNDERTONE_WORDS = ['冷皮', '自然', '暖皮']
function colorSpec(person) {
  const p = person || {}
  const ln = p.skin_lightness
  const lightness01 =
    ln !== undefined && ln !== null && ln !== ''
      ? Math.max(0, Math.min(1, Number(ln) / 100))
      : undefined
  const synth = synthesizeSkinLab(
    p.skin_tone_detail || p.skin_tone || null,
    p.skin_hue,
    lightness01,
  )
  const anchors = []
  const add = (a) => {
    if (anchors.some((x) => x.lab.L === a.lab.L && x.lab.a === a.lab.a && x.lab.b === a.lab.b))
      return
    anchors.push(a)
  }
  const push = (value, fromDetail) => {
    if (!value) return
    const name = String(value).trim()
    // 照片在场 ⇒ 冷暖那颗离散锚点被实测角度顶掉（同一个口径的更细读数，⛔ 不是再叠一个口径）
    if (synth !== null && UNDERTONE_WORDS.includes(name)) return
    const lab = skinToneToLab(value)
    if (!lab) return
    add({ field: fromDetail || DEEP_WORDS.includes(name) ? '深浅' : '冷暖', name, lab })
  }
  push(p.skin_tone_detail, true)
  push(p.skin_tone, false)
  if (synth !== null) {
    add({
      field: '冷暖',
      name: `照片色相 ${Math.round(synth.lab.h)}°（${synth.undertone}）`,
      lab: synth.lab,
      from_photo: true,
    })
  }
  if (anchors.length === 0) {
    return { present: false, reason: '肤色没填或认不出这个色 ⇒ 颜色这一整段不出，不替你猜' }
  }
  const rows = []
  for (const name of Object.keys(COLOR_NAME_HEX)) {
    const fits = anchors.map((an) => ({ an, fit: colorFit(an.lab, name) })).filter((x) => x.fit)
    if (fits.length === 0) continue
    const worst = fits.reduce((a, b) => (b.fit.score < a.fit.score ? b : a))
    rows.push({
      ...worst.fit,
      score: Math.min(...fits.map((x) => x.fit.score)),
      limit_field: worst.an.field,
    })
  }
  if (rows.length === 0) {
    return { present: false, reason: '词表里的颜色一个都没法算色差 ⇒ 颜色段不出' }
  }
  rows.sort((a, b) => b.score - a.score)
  const uniq = []
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.top_hex)) continue
    seen.add(r.top_hex)
    uniq.push(r)
  }
  const primary = anchors[0]
  return {
    present: true,
    skin_label: anchors.map((x) => `${x.field} ${x.name}`).join('／'),
    skin_lab: { L: primary.lab.L, a: primary.lab.a, b: primary.lab.b },
    /** 照片色相角是否接管了冷暖这一格（10-21 第五处取值点补口；过不了闸恒 null） */
    photo_hue: synth ? synth.lab.h : null,
    /** 顶掉冷暖那颗离散锚点之后实际进 `colorFit` 的 Lab；⛔ L 与 C 一律来自 C 档锚点表 */
    photo_lab: synth
      ? { L: synth.lab.L, a: synth.lab.a, b: synth.lab.b, h: synth.lab.h, C: synth.lab.C }
      : null,
    photo_undertone: synth ? synth.undertone : null,
    anchor_count: anchors.length,
    scoring: anchors.length > 1 ? 'min' : 'single',
    tier:
      'A 色差公式（GB/T 7921-2008／ISO-CIE 11664）＋ B 方向（Schloss & Palmer 2011 图形色-背景分离、Zhang 2025 DOI 10.1111/cote.12828 衣装明度）＋ C 合成分权重（手拍）' +
      (synth
        ? '；这一条吃了照片色相角：切点 52.86／64.02 与 h 闸 36.36～78.05 的下上沿＝CIE TC 1-92 华裔子集 P25/P75、P5/P95（B 档），两侧各外扩 8 度与浏览器取样框＝C 档手拍；明度 L 与彩度 C 一律仍取自 C 档锚点表，⛔ 不吃照片的绝对明度'
        : ''),
    prefer: uniq.slice(0, COLOR_TOP_N).map((r) => ({
      name: r.top_label,
      hex: r.top_hex,
      score: r.score,
      deltaE00: r.deltaE00,
      dHue: r.dHue,
      dL: r.dL,
      limit_field: r.limit_field,
    })),
    avoid: uniq
      .slice(-COLOR_AVOID_N)
      .map((r) => ({ name: r.top_label, hex: r.top_hex, score: r.score })),
    note:
      anchors.length > 1
        ? '这几个色是"跟你的肤色在色度学上分离得开"的排序，深浅与冷暖两个口径都算、取更低那个分。分只保证同一个人内部的相对次序，不是"好不好看"的判定'
        : '这几个色是"跟你的肤色在色度学上分离得开"的排序。分只保证同一个人内部的相对次序，不是"好不好看"的判定',
  }
}

/**
 * 主入口：一个人 ⇒ 一张上衣规格表，三层按固定顺序出，**永不合并成一个分**。
 *  第 0 层 合身（`fit`，GB/T 1335 号型 + 四道部位判据）
 *  第 1 层 修形（`axes`，六轴 want 向量）
 *  第 2 层 颜色（`colour`，与肤色 Lab 的色差排序；填了合格的照片色相角 ⇒ 那一档的 a/b 换成实测角度）
 * @param {object} person 档案（enrich 前后都行，字段名走 profileEnricher 口径）
 * @returns {null|{inputs, fit, axes, colour, missing, note, evidence}}
 *          三层都出不了 ⇒ 返回 null（缺测不出处方）
 */
function topSpec(person) {
  const p = person || {}
  const dev = bodyDeviation(p)
  const fit = fitLayer(p, dev)
  const { axes, missing } = axisSpecs(p, dev)
  const colour = colorSpec(p)

  if (!fit.present && axes.length === 0 && !colour.present) return null

  return {
    inputs: {
      ...dev.measure,
      want: dev.want,
      ease_window_cm: dev.ease_window,
      skin_tone: p.skin_tone || p.skin_tone_detail || null,
      skin_tone_detail: p.skin_tone_detail || null,
      // 照片那一维只吃角度，且只有过闸才被记进 inputs（18 §2.4：本规范没有 skin_lab 这一格）
      skin_hue: colour.present ? colour.photo_hue : null,
    },
    fit,
    axes,
    colour,
    missing,
    note:
      '顺序是定的：**先看尺寸合不合（第 0 层），再看往哪修（第 1 层），最后才是颜色（第 2 层）**。' +
      '第 0 层与第 1 层的结论可以相反（例如"要买 88A 这一档"和"松量往这收"），那是正确的，不许调和成一个分。' +
      '修形六维与颜色只回答"往哪修、跟肤色分不分得开"；没有任何标准或文献规定这样穿就好看——方向有实证，刻度、阈值和权重是我们手拍的标定值。',
    evidence:
      '第 0 层：GB/T 1335.1/.2-2008 号型（现行；分档值与按性别的常用档系表列＝本机 PDF 逐字核对【官方原文·文本层逐字】）＋ GB/T 16160-2017（腰际线等测量口径）＋ GB/T 5703-2023 §6.2.7（肩宽取两肩峰点直线距离，家用软尺只当参考值）＋ GB/T 31901-2024 表 A.2（胖瘦程度按 BMI，2026-12-01 实施 ⇒ 现为内部口径）＋ 肩缝容差 C 手拍；' +
      '第 1、2 层：A 色差公式 + B 方向（Pazhoohi 2023／Liu 2006／Sakata 2020／Koutsoumpis 2021／Schloss & Palmer 2011／Zhang 2025）+ C 刻度、松量→款式、中性阈值 0.15、颜色权重（全部手拍，标定中）',
    layer_order: ['fit', 'axes', 'colour'],
    axis_tiers: axes.reduce((acc, a) => {
      acc[a.key] = tierOf(a.key)
      return acc
    }, {}),
  }
}

module.exports = { topSpec, SPEC, NEUTRAL_BAND, COLOR_TOP_N, COLOR_AVOID_N }
