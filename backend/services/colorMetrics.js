/**
 * 色度学工装：把"这件上衣衬不衬这个人"拆成可复算的物理量。
 * 依据档位（2026-10-06 逐条核实，详见 docs/上衣量化依据与公式清单.md）：
 *   A 档（国标/国际标准）：sRGB→CIELAB(D65) 换算、色差公式 —— GB/T 7921-2008《均匀色空间和色差公式》、ISO/CIE 11664 色度学
 *   B 档（同行评议）：CIEDE2000 实现 Sharma et al. 2004 (DOI 10.1002/col.20070)；
 *                     Schloss & Palmer 2011 (DOI 10.3758/s13414-010-0027-0, PMC3037488) 全文里
 *                       有两句方向相反的结论，必须分清用哪一句：
 *                       ① "pair preference and harmony both increase as hue similarity increases"
 *                          —— 两块色当**一个整体**看时，越像越和谐；
 *                       ② "figural color preference ratings increase as hue contrast with the
 *                          background increases" —— **图形色衬背景色**时，色相差越大越被偏好。
 *                       上衣衬脸属于第②句（衣是图形色、脸是背景）⇒ 本模块按对比打分（10-08 改，
 *                       原来这里第①句的口径把 45% 权重加错了边，见 docs/依据/08 §8.2）。
 *                       第①句"越像越和谐"只适用于两件单品之间 ⇒ 它走 outfitHarmony，量的是**单品互相**，
 *                       与②的对象不同（②量衣 vs 脸）。10-19 第一阶段·止血第 4 条起，这个呼应分
 *                       按 30% 份额进 colorFit 总分（HARMONY_SHARE），两个分量各自回在
 *                       contrast_score / harmony_score 里可拆回账；原先"不进这条分"的写法是因为
 *                       ①②若都拿"衣 vs 脸"当对象就会把两句相反的结论加进同一个数——现在不是。
 *                       ⚠️ 这条与 docs/依据/08 §8 通用骨架第 2 条「两者不能加进同一个数」的
 *                       字面仍有出入，已列入本轮待裁事项。
 *                     Gong & Lee 2019, Coloration Technology 135(4):292-304
 *                       (DOI 10.1111/cote.12405) 的和谐四规则是下一步要替换本条轴的东西，尚未实现。
 *                     衣装明度↓⇒面部肤色被评为更显白 Zhang et al. 2025, Coloration Technology 142(2):259-271 (DOI 10.1111/cote.12828)；
 *                     ITA° 分档切点 ⇒ 🟢 10-10 第二十一轮改口（旧写法把这四个切点归给 Osto et al. 2022, DOI 10.1111/php.13562 ＝张冠李戴，那篇证的是"ITA 六档与 Fitzpatrick 六型不可互换"，不含任何切点）。上四档逐字出处＝Saint-Léger 2015, Int J Cosmet Sci 37:259-265, DOI 10.1111/ics.12194 第 2 页「10–28°: Tan/Matt; 28–41°: Intermediate; 41–55°: Light; and >55°: Very Light」⇒【官方原文·本机 PDF】（docs/依据/papers/人类皮肤的颜色：富有成效的科学，却用词不合适.pdf，290,862 B／7 页／md5 d084391dc334e82404036678b5e71742，核对记 docs/依据/10 §2i③）。⛔ 三条限定：① brown/dark 两档本机原文里没有（该文只给到上四档；代码用的 −30 下界与通行 −3 不是同一个数，未裁）⇒【未核实】，属本工程自定；② 该文自己把切点指向 US FDA／Cosmetics Europe 指南 ⇒ 那一层仍【二手】；③ 概念起源 Chardon et al. 1991, DOI 10.1111/j.1467-2494.1991.tb00561.x 本机无原文 ⇒【B·DOI 已证·本机无原文】，不许说成"科学分档"。
 *   C 档（本工程自定，不是文献值）：色名→hex 词表、下面的合成分权重。
 *     换掉 C 档这两样之前，本模块只能算"相对差异"，不能对外宣称"科学测色"。
 *     （肤色档→Lab 锚点原列 C 档，10-29 已换成 CIE 汇编华裔 404 人分位子样实测、升 B 档，
 *       逐档出处与限定见 SKIN_TONE_ANCHORS 块注释；仍非测色仪逐人实测，对外口径不变。）
 */

// ------------------------------------------------------------
// 1. 换算：sRGB hex → CIELAB(D65)
// ------------------------------------------------------------
const { ownValue } = require('../utils/common')

const _srgbToLin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** '#RRGGBB' / 'RRGGBB' → {L,a,b,C,h}；解析失败返回 null */
function hexToLab(hex) {
  const m = String(hex || '')
    .trim()
    .replace(/^#/, '')
    .match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
  if (!m) return null
  const [R, G, B] = [m[1], m[2], m[3]].map((h) => _srgbToLin(parseInt(h, 16)))
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X / 0.95047)
  const fy = f(Y / 1.0)
  const fz = f(Z / 1.08883)
  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const b = 200 * (fy - fz)
  return { L, a, b, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI }
}

/** 色相对比角 Δh（0~180，越小越"同族"）；只给 {L,a,b} 没有 h 也能算 */
const _hueAngle = (lab) => (Math.atan2(lab.b, lab.a) * 180) / Math.PI
function hueGap(lab1, lab2) {
  const d = Math.abs(_hueAngle(lab1) - _hueAngle(lab2)) % 360
  return d > 180 ? 360 - d : d
}

/** CIEDE2000 色差（Sharma 2004 的标准系数，kL=kC=kH=1）
 *  注意：CIE 色相角约定为 [0,360)，atan2 直接回负值会把 H̄'、T、RT 全带歪，
 *  必须 _hue360 归一后再进平均色相分支。 */
const _hue360 = (deg) => {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

function deltaE00(l1, l2) {
  const { L: L1, a: a1, b: b1 } = l1
  const { L: L2, a: a2, b: b2 } = l2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = _hue360((Math.atan2(b1, a1p) * 180) / Math.PI)
  const h2p = _hue360((Math.atan2(b2, a2p) * 180) / Math.PI)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p
    if (Math.abs(diff) <= 180) dhp = diff
    else if (diff > 180) dhp = diff - 360
    else dhp = diff + 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp
  if (C1p * C2p === 0) hbp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180)
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const RT = -RC * Math.sin((2 * dTh * Math.PI) / 180)
  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  )
}

/** ITA°（肤色专用；灰色/无彩色上无意义）。⛔ 只能吃色卡比对值或测色仪读数：非受控照片推肤色不可靠，见 Alipour, Burke & Courtney 2026, Skin Res Technol 32(8), DOI 10.1111/srt.70374【二手·官方 XML 原件 10-10 已删，本机仅存本站转出全文】⇒ 这条限制不许因为切点升档而松动，也不许拿它做对外话术。切点出处见本文件头（上四档＝Saint-Léger 2015 p2【官方原文·本机】；brown/dark【未核实】）。*/
function individualTypologyAngle(lab) {
  if (!lab || lab.b === 0) return null
  // atan 返回弧度，ITA° 定义是角度制 ⇒ 换算系数是 180/π
  return (Math.atan((lab.L - 50) / lab.b) * 180) / Math.PI
}
const itaClass = (v) =>
  v === null
    ? null
    : v > 55
      ? 'very light'
      : v > 41
        ? 'light'
        : v > 28
          ? 'intermediate'
          : v > 10
            ? 'tan'
            : v >= -30
              ? 'brown'
              : 'dark'

// ------------------------------------------------------------
// 2. C 档：色名 → 代表色值（本工程标定，不是文献值）
//    词表按 db/seed/rules-aesthetic*.json 与 rules.json 里真出现过的色名收口。
//    10-20 第六阶段·第一步：58 ⇒ 232 键。新增的 174 键由盘外工装
//    `E:/website/站3产生临时文件/phase6-20261020/gen-lexicon.cjs` 按 HSL 色相族 ×
//    明度三档（浅 .83／中 .60／深 .34）生成、人工挑名后收口，**没有一个色值来自标准或色卡**：
//    GB/T 15608-2006《中国颜色体系》是色名＋色号（PCCS 式体系）侧的规范、本机 69 页目视读下来
//    不含"流行色名→数值"对照表；GB/T 3977-2008《颜色的表示方法》通篇是 CIELAB 表示法与色差定义、
//    不认色名 ⇒ 这两本只能背书"用 Lab 说话"，不能给这张表背书（现量判据见 docs/依据/14 §1.3）。
//    ⇒ 整张表仍是 C 档，对外不得说成"科学测色/国标取色"。
//    ⚠️ 合并只增不改：现役 58 键的 hex 一个都没动（本脚本替换后逐键现量验证），
//      所以改动前那条推荐取到的色值不会变；变的是'以前认不出、现在认得出'那一批。
// ------------------------------------------------------------
const COLOR_NAME_HEX = {
  // —— 现役 58 键（10-19 标定基线，一个值都没改）——
  正红: '#C8102E',
  橘红: '#E4552B',
  砖红: '#A6412C',
  土红: '#9C4A38',
  酒红: '#6E1E2B',
  玫红: '#C73E6B',
  桃红: '#E27A8C',
  珊瑚粉: '#F08A6E',
  蜜桃色: '#F4A98B',
  蜜桃: '#F4A98B',
  雪粉: '#F6D7DA',
  樱花粉: '#F7C6D0',
  灰粉: '#D3AFAE',
  豆沙粉: '#B07C78',
  粉彩: '#F2D8D8',
  鹅黄色: '#F5E1A4',
  鹅黄: '#F5E1A4',
  姜黄色: '#C89A2B',
  姜黄: '#C89A2B',
  土黄: '#B8963F',
  奶橘: '#F6C79A',
  暖橘: '#E2823C',
  橘色: '#E8762C',
  焦糖: '#A9682F',
  驼色: '#B4915F',
  暖驼: '#A97F4F',
  浅驼: '#CBAE85',
  咖啡棕: '#5B3A24',
  棕色: '#7B4F2A',
  大地色: '#9C7A50',
  奶油白: '#F5EFE0',
  米白: '#F2EDE3',
  奶杏色: '#EFD9BC',
  白色: '#FFFFFF',
  黑色: '#111111',
  墨黑: '#0B0B0B',
  浅灰: '#D3D6D8',
  中灰: '#8C9196',
  冷灰: '#9AA3A8',
  枪灰: '#4A4F54',
  银灰: '#C4C9CC',
  藏蓝: '#1F3A5F',
  藏青: '#1F3A5F',
  宝蓝: '#1149A6',
  蓝灰: '#6E8095',
  雾霾蓝: '#8FA9B8',
  霾蓝: '#8FA9B8',
  紫蓝: '#4A4E9B',
  灰紫: '#8E82A0',
  薰衣草紫: '#B7A6D6',
  墨绿: '#1E3B31',
  橄榄绿: '#6B7A3A',
  榄绿: '#6B7A3A',
  薄荷绿: '#A7D8C4',
  青碧: '#2E8B8B',
  金色: '#C9A227',
  银色: '#C0C4C8',
  荧光色: '#D6FF3F',
  浅红: '#E7C0C4',
  红: '#DD5563',
  深红: '#951825',
  浅玫红: '#E4C3D0',
  深玫红: '#8C214C',
  浅橙: '#E9D2BF',
  橙: '#E29450',
  深橙: '#9A5213',
  浅黄: '#E9E1BE',
  黄: '#E4C64E',
  深黄: '#9C8011',
  嫩芽绿: '#D7E1C6',
  黄绿: '#A6C86A',
  深黄绿: '#62822B',
  浅绿: '#C7E1CC',
  绿: '#6CC67E',
  深绿: '#2D803E',
  浅青: '#C8DFDD',
  青: '#72C0BB',
  深青: '#327B76',
  浅蓝: '#C4D0E4',
  蓝: '#618ED1',
  深蓝: '#234C8B',
  浅紫蓝: '#C8C7E1',
  深紫蓝: '#332D80',
  浅紫: '#D6C8DF',
  紫: '#A172C0',
  深紫: '#5E327B',
  浅品红: '#E1C6DC',
  品红: '#C86AB5',
  深品红: '#822B71',
  纯白: '#FCFBFB',
  本白: '#F7F7F5',
  象牙白: '#F3F1E7',
  珍珠白: '#F4F3F1',
  云白: '#F4F5F6',
  骨白: '#EBE7E0',
  蛋壳色: '#EFEDE3',
  米色: '#EAE3D2',
  杏色: '#E7D4C1',
  炭灰: '#3B3C40',
  烟灰: '#94999E',
  石灰: '#BFC3C4',
  水泥灰: '#9A9FA2',
  大象灰: '#878078',
  驼灰: '#B3AA9E',
  雾灰: '#C9CBCF',
  炭黑: '#1F2023',
  哑光黑: '#161618',
  乌黑: '#0F0F10',
  银: '#CED1D4',
  金: '#D0AD39',
  铜: '#BE6D37',
  古铜: '#7B5432',
  香槟金: '#DBD3B3',
  燕麦色: '#D7CBB7',
  燕麦: '#D7CBB7',
  拿铁: '#C6B49F',
  奶茶色: '#D1BDA9',
  摩卡: '#7E5D44',
  卡其: '#A99860',
  军绿: '#677740',
  迷彩绿: '#667E4E',
  牛油果绿: '#A7C17B',
  牛油果: '#A7C17B',
  抹茶: '#87B766',
  森绿: '#2F6047',
  鼠尾草绿: '#AAB9A2',
  松绿: '#3E6F5F',
  苹果绿: '#A6D98C',
  克莱因蓝: '#0F3DC7',
  钴蓝: '#1661CA',
  湖蓝: '#2894C3',
  湖水蓝: '#58B4D0',
  天蓝: '#6AB9E7',
  天空蓝: '#91C4E8',
  钢蓝: '#61829E',
  靛蓝: '#27387C',
  牛仔蓝: '#355F97',
  水洗蓝: '#8BACC6',
  原色牛仔: '#1D3367',
  墨蓝: '#1E2A48',
  普鲁士蓝: '#1B4774',
  海军蓝: '#1F335C',
  香芋紫: '#C4A7D2',
  芋泥紫: '#AD92BF',
  茄紫: '#5B3465',
  梅子色: '#7B3D66',
  暮紫: '#6F5A87',
  紫罗兰: '#A55CD6',
  莫兰迪粉: '#C9B1B6',
  莫兰迪: '#BAB0AB',
  藕粉: '#D9BFC4',
  裸粉: '#D4B8AF',
  胭脂: '#C73850',
  腮红粉: '#E0A3AF',
  干枯玫瑰: '#AA747B',
  桃粉: '#E2B6BD',
  西柚色: '#DE8873',
  柿子橙: '#DD7A40',
  南瓜色: '#D47A2B',
  琥珀: '#D08C25',
  夕阳橙: '#E28150',
  珊瑚橘: '#E39478',
  朱红: '#E43F25',
  猩红: '#CA161C',
  绯红: '#E05260',
  枣红: '#6B242D',
  铁锈红: '#97442B',
  勃艮第: '#5C1F31',
  暗红: '#772227',
  中国红: '#CE1C1C',
  大红: '#DF1D16',
  芥末黄: '#C7AF38',
  咖喱色: '#BC962F',
  蜂蜜色: '#DAB662',
  小麦色: '#CBB286',
  栗色: '#6D462C',
  可可: '#895A43',
  巧克力色: '#5D3B28',
  赭石: '#A45F3D',
  陶土色: '#BE7C60',
  沙色: '#D3C6A6',
  亚麻色: '#CAC0A5',
  胡桃色: '#79583E',
  焦糖棕: '#996333',
  荧光粉: '#FF3D9E',
  荧光绿: '#8FFF1F',
  荧光黄: '#FFFF33',
  薄荷: '#AFDECF',
  雾霾紫: '#B3A6BF',
  雾霾灰: '#B2B8BD',
  深灰: '#686A6E',
  铁灰: '#585B5F',
  石墨色: '#4A4C4F',
  陨石灰: '#6D6F78',
  暖白: '#F3F1EC',
  冷白: '#F0F2F4',
  中性灰: '#808080',
  米灰: '#CFCABF',
  粉白: '#EFE6E7',
  银白: '#E4E6E7',
  浅卡其: '#C3B798',
  深卡其: '#877145',
  深驼: '#966E40',
  黄棕: '#9C783A',
  红棕: '#8A462E',
  橄榄棕: '#807842',
  奶茶棕: '#B99E83',
  金棕: '#AF8131',
  草绿: '#72C23D',
  葱绿: '#ADD798',
  豆绿: '#A1BF88',
  苔绿: '#729051',
  孔雀绿: '#317D73',
  绿松石: '#51C2BA',
  祖母绿: '#267359',
  蓝绿: '#398A93',
  紫红: '#9B3174',
  梅红: '#9C3A61',
  藕荷: '#BCA5C0',
  丁香紫: '#CCB1D3',
  樱粉: '#E8C4D0',
  浅米: '#E2DCCA',
  深米: '#C6B695',
  浅墨绿: '#619E88',
  雾霾绿: '#A9BCB3',
  灰: '#808080',
  粉: '#DEAFB7',
  浅粉: '#E8CED3',
  深粉: '#C95477',
  褐: '#6C4C37',

  // —— 扩表新增（2026-10-20 第六阶段，全部 C 档自建锚点：色相与明度按中文语感标定，出处见 docs/依据/14 §一 1.4）——
  // 无彩色与近无彩色（这族直接决定 ACHROMATIC_C 那条判线的键数）
  // 流行色与口语色（你点名的那批在这里）
  // 补收的常用颜色词（语料与日常话里会写、前三批没收的）
  白: '#FFFFFF',
  黑: '#111111',
}

// ------------------------------------------------------------
// 2b. C 档：色彩同义词库（口语别名 → 词表规范键）
//     第六阶段·第一步 2026-10-20 新增。三条硬口径，都是现量决定的：
//     ① **别名一律不进 COLOR_NAME_HEX。** 表里已经有 232 个键，`_firstColorNameIn()` 是
//        按"句内位置"扫全表的，别名再进表就跟规范键抢同一个位置，抽色会挑到别名那条。
//     ② **只收"机械规则救不了"的那批。** 归一链（`normalizeColorName`）先做「去尾『色』」和
//        「补尾『色』」两步，所以 卡其色→卡其、薄荷色→薄荷、大红色→大红 这类自己就通了，
//        写进同义词库是重复劳动；这里只留**字面不同**的（咖啡色↔咖啡棕、松石绿↔绿松石、
//        裸色↔奶杏色）。判据与名单来源见 docs/依据/14 §二 L3。
//     ③ **这张表能验的是什么（别假装有验不了的依据）**：别名自己没有 hex（有 hex 就该进表），
//        所以"别名与规范键 ΔE00<5"这种说法对它根本不成立 ⇒ 测试改成三条算得出的不变量：
//        (a) 别名不得与 COLOR_NAME_HEX 撞键（撞了＝同一个色名两处各写一个值）；
//        (b) 每个别名指向的规范键必须在表里且 `hexToLab` 认得出；
//        (c) 别名走「去尾『色』／补尾『色』」两步机械规则时必须**认不出来**（返回 null）——
//            认得出就说明这条同义词是死代码，或者跟机械规则抢同一条输入。
//        现量（2026-10-20，工装 `phase6-20261020/synonym-check.cjs`）：别名 42 条，
//        (a) 撞键 0 条、(b) 未命中 0 条、(c) 机械规则可认 0 条 ⇒ 三条全过。
//        撞过表的教训有实据：起草时把 拿铁/摩卡/抹茶/米色/苹果绿 当过别名，现量它们**已经是键**，
//        留着就是 (a) 那一类错误 ⇒ 删掉，改由第 1 步精确命中处理。
//     ⚠️ 不许并进来的三对（他点名的「驼色=卡其色=棕色」这条要求**没有采纳**，原因在这儿）：
//        驼色↔卡其 ΔE00 6.8、驼色↔棕色 25.4、卡其↔棕色 28.6，L 分别 62.3／63.1／37.8
//        ⇒ 三者都在 FUSION_GATE 的 15~30 触发带内可分辨，并成一个数＝把 25 单位的明度差抹平，
//        而明度差正是 brighten 那 35% 权重的输入。见下方 COLOR_ANTI_SYNONYMS 与 §2d。
// ------------------------------------------------------------
const COLOR_SYNONYMS = {
  咖啡色: '咖啡棕',
  咖啡: '咖啡棕',
  奶咖: '奶茶棕',
  卡其布色: '卡其',
  橄榄色: '橄榄绿',
  橄榄: '橄榄绿',
  松石绿: '绿松石',
  湛蓝色: '深蓝',
  肤色: '奶杏色',
  裸色: '奶杏色',
  肉色: '奶杏色',
  米黄: '米色',
  米黄色: '米色',
  乳白: '奶油白',
  乳白色: '奶油白',
  象牙: '象牙白',
  珍珠: '珍珠白',
  香槟: '香槟金',
  柿子: '柿子橙',
  夕阳: '夕阳橙',
  珊瑚: '珊瑚橘',
  朱砂: '朱红',
  玫瑰: '玫红',
  玫瑰色: '玫红',
  腮红: '腮红粉',
  胭脂红: '胭脂',
  藕色: '藕荷',
  香芋: '香芋紫',
  芋泥: '芋泥紫',
  薰衣草: '薰衣草紫',
  丁香: '丁香紫',
  克莱因: '克莱因蓝',
  牛仔: '牛仔蓝',
  水洗: '水洗蓝',
  鼠尾草: '鼠尾草绿',
  水泥: '水泥灰',
  石墨灰: '石墨色',
  迷彩: '迷彩绿',
  靛青: '靛蓝',
  黛蓝: '墨蓝',
  绛: '深红',
  绛色: '深红',
}

/**
 * 明令**禁止**当成同义词的色名对（防的是以后有人为了"提高识别率"把它们并掉）。
 * 每对的 ΔE00、L、C 都是现量（2026-10-20，词表 232 键；工装 `phase6-20261020/synonym-check.cjs`）。
 * 反向断言写法：非 `same` 的每一对必须 ① 两个 hex 不相等 ② ΔE00 ≥ 4
 * （这批里的最小值是 珊瑚粉↔珊瑚橘 4.1，所以条线取 4 而不是 5 —— 取 5 会让这条测试当场红）。
 * `same: true` 那对是"同义"的正例（藏青/藏蓝 本来就是同一个 hex），列在这里只为让断言放过它。
 */
const COLOR_ANTI_SYNONYMS = [
  {
    a: '驼色',
    b: '卡其',
    dE: 6.8,
    why: '口语常混，但明度/彩度差到能改闸门档位（都在 15~30 触发带内）',
  },
  {
    a: '驼色',
    b: '棕色',
    dE: 25.4,
    why: 'L 62.3 vs 37.8 ⇒ 差 24.5 明度单位，正好是 brighten 轴的 60%',
  },
  { a: '卡其', b: '棕色', dE: 28.6, why: '同上' },
  {
    a: '燕麦色',
    b: '米色',
    dE: 5.8,
    why: '流行色与基础色的区分点，并了就没法解释"为什么推燕麦不推米"',
  },
  { a: '雾霾蓝', b: '牛仔蓝', dE: 29.3, why: '同为蓝但低彩度 vs 高彩度，衬脸效果相反' },
  {
    a: '珊瑚粉',
    b: '珊瑚橘',
    dE: 4.1,
    why: '唯一一对故意留 4.1 <5 的：彩度 48.2 vs 38.0 差得明显，不许并',
  },
  {
    a: '藏青',
    b: '藏蓝',
    dE: 0,
    why: '这俩是同一个 hex，是"同义"的正例，列在这里是为了让反向断言放过它',
    same: true,
  },
]

// ------------------------------------------------------------
// 2c. C 档：色系软标签（L4）——只做分组与文案，**永远不进 ΔE00／不进分数**
//     为什么按"色名里带的族字"分族，而不是按色相角：现量比过两把尺子
//     （工装 `phase6-20261020/family-ruler.cjs`，232 键全表）——
//       · 按 **Lab 色相角** 切八段：与色名自带族字打架 **106/221** 条
//         （驼色 h78、鹅黄 h93、姜黄 h84、黄 h92 全落进"绿"区 ⇒ Lab 的角在低彩度暖色上不分黄/绿/棕）
//       · 按 **HSL 色相角** 切八段：打架 **61/221** 条（好一半，仍有 米色/燕麦色/奶茶色 被算成橙、
//         军绿/牛油果绿/橄榄绿 被算成黄）
//       · 按 **色名族字**（中文色名九成自带族字：雾霾蓝→蓝、灰紫→紫、藕粉→粉）：这才是人读到的那个族
//     ⇒ 主判据取族字，名字里实在没有族字的（藏青／焦糖／大地色／雪粉／拿铁／莫兰迪…）才退回 HSL 角。
//     这张表仍然不是"科学"：分界角与词表都是 C 档手拍，它的作用只有两个——
//     给报告做"推的是哪个色系"的分组，和给"男深女浅"那类偏好提供**明度档**以外的第二个标签。
// ------------------------------------------------------------

/** 色名里出现即定族的字／词；同一条名字里取**位置最靠后**的那个（灰紫⇒紫，蓝灰⇒灰，藕粉⇒粉） */
const COLOR_FAMILY_WORDS = [
  ['粉', '粉'],
  ['桃', '粉'],
  ['玫瑰', '粉'],
  ['红', '红'],
  ['橙', '橙'],
  ['橘', '橙'],
  ['南瓜', '橙'],
  ['黄', '黄'],
  ['绿', '绿'],
  ['碧', '青'],
  ['青', '青'],
  ['蓝', '蓝'],
  ['紫', '紫'],
  ['棕', '棕'],
  ['褐', '棕'],
  ['驼', '棕'],
  ['咖', '棕'],
  ['焦糖', '棕'],
  ['大地', '棕'],
  ['栗', '棕'],
  ['杏', '棕'],
  ['米', '棕'],
  ['拿铁', '棕'],
  ['摩卡', '棕'],
  ['巧克力', '棕'],
  ['奶茶', '棕'],
  ['燕麦', '棕'],
  ['亚麻', '棕'],
  ['胡桃', '棕'],
  ['赭', '棕'],
  ['陶土', '棕'],
  ['沙', '棕'],
  ['琥珀', '棕'],
  ['金', '黄'],
  ['蜂蜜', '黄'],
  ['灰', '无彩色'],
  ['白', '无彩色'],
  ['黑', '无彩色'],
  ['银', '无彩色'],
  ['炭', '无彩色'],
  ['烟', '无彩色'],
  ['雪', '无彩色'],
  ['骨', '无彩色'],
]

/**
 * 显式覆写表。两类都要，理由都是现量（2026-10-20，`phase6-20261020/synonym-check.cjs` 打的兜底名单）：
 * ① **族字与色值互相矛盾**——藏青 的族字是"青"，可它的 HSL 角 229°、Lab 角 277° 都说蓝，
 *    而口语里藏青就是深蓝。（军绿／橄榄绿／牛油果绿 一度也想写进来，实测**不用**：
 *    它们的族字"绿"位置就在最后，主判据已经给对了 ⇒ 覆写表里不该留没用的条目，已删。）
 * ② **名字里没有族字、HSL 角又落错区**——卡其 46° 会被算成黄（该是棕）、牛油果 82° 算成黄（该是绿）、
 *    勃艮第 340° 算成粉（该是深红）、西柚色 11.8° 算成红（该是粉）。
 * ③ 绿松石／松石绿 的族字给的是"绿"，但口语把它归青（turquoise），两处一起点名。
 * 这张表跟着兜底名单走：名单里出现"人看着不对"的就点名进来，不改分界角
 * （改角会连带挪动另外几十个键，代价大得多，见 §2c 那两把尺子的 106/61 打架率）。
 */
const COLOR_FAMILY_OVERRIDES = {
  藏青: '蓝',
  牛油果: '绿',
  卡其: '棕',
  勃艮第: '红',
  西柚色: '粉',
  蛋壳色: '无彩色',
  绿松石: '青',
  松石绿: '青',
  莫兰迪: '无彩色',
}

/** 退回用的 HSL 色相角分段（C 档手拍；61/221 打架率见上，所以只当兜底不当主判据）。
 *  棕/橙这一带 HSL 角本来就重叠（卡其 45°、驼色 38°、焦糖 30°、橘色 24°），
 *  这里**不再按明度拆**：浅与深归 §2d 的明度档管，色系只回答"它属于哪一族"。 */
const COLOR_HSL_FAMILY_BANDS = [
  { family: '红', from: 350, to: 12 },
  { family: '粉', from: 330, to: 350 },
  { family: '紫', from: 270, to: 330 },
  { family: '蓝', from: 195, to: 270 },
  { family: '青', from: 165, to: 195 },
  { family: '绿', from: 85, to: 165 },
  { family: '黄', from: 45, to: 85 },
  { family: '棕', from: 12, to: 45 },
]

// ------------------------------------------------------------
// 2d. C 档：明度族（L5）——「深色上衣」这类文案唯一能走的路
//     「深/浅/亮/暗」四个单字在 524 条结论文本里出现 228 次（深 133／浅 69／亮 24／暗 2；其中成词
//     「深色 55／浅色 20／亮色 15／暗色 2」＝92 次。现量工装 `phase6-20261020/band-token-census.cjs`，
//     尺子＝ro3.db 10-19 19:45 副本、enabled 组的四类动作），**永远翻不出 hex**，
//     因为它们是"一档亮度"而不是"一个颜色"。所以单独一层，只喂 brighten 轴（Zhang 2025
//     那条"衣装明度↓⇒脸显白"本来就不需要具体色相，只需要方向），
//     色相轴与彩度轴按"没有信息"各记 0.5，与无彩色那条约定同一个写法。
//     阈值 L≤35＝深色、L≥65＝浅色 是**语义切点**（中文口语里"深色/浅色"就在这个位置），
//     不是等分切点。现量（2026-10-20，232 键，L 分布工装 `phase6-20261020/synonym-check.cjs` 末段）：
//     深色 33 键／中间 88 键／浅色 111 键 —— 偏浅 3.4 倍。这条读数本身要报出去：
//     词表现在缺深色键，"男性推深色系"那类偏好能挑的只有 33 个色名，等分切点会把这件事藏起来。
// ------------------------------------------------------------
const LIGHTNESS_BANDS = {
  深: { label: '深色', lMax: 35, brightenHint: 0.8 },
  中: { label: '中间色', lMin: 35, lMax: 65, brightenHint: 0.5 },
  浅: { label: '浅色', lMin: 65, brightenHint: 0.2 },
}

/** 文案里的明度词 → 档；这张表也是"这一条到底有没有具体色"的判据 */
const LIGHTNESS_TOKENS = {
  深色: '深',
  深色系: '深',
  暗色: '深',
  暗色系: '深',
  浓色: '深',
  重色: '深',
  浅色: '浅',
  浅色系: '浅',
  亮色: '浅',
  亮色系: '浅',
  淡色: '浅',
  淡色系: '浅',
  中间色: '中',
  中性色: '中',
}

// ------------------------------------------------------------
// 2e. 元词黑名单（第十三阶段·第一步 §二·2，规范 `docs/依据/21`）
//     「肤色／肉色／腮红」指的是**人或脸上那件东西**，不是衣服的颜色 ⇒ 它们永远不许
//     被当成一个色名供数（措辞红线见 `21` §一·5）。
//     现量（2026-10-21，盘外只读副本 `base.db` 全库 1,879 行 `rule_actions.content`；
//     工装 `phase13-20261021/probe-metawords.cjs`＋`probe-metaslots.cjs`）：
//       · 「肤色」全库造出 **9 个 hex**／9 行，其中 id=302「发型改造需结合脸型、肤色、身高综合判断」
//         走的是 `COLOR_SYNONYMS` 的 `肤色→奶杏色`——**全库唯一一条由这三个词直接命中的假色值**；
//       · 「腮红」造出 20 个 hex／19 行，全是句内扫描在「腮红」肚子上取到单字键 `红 #DD5563`；
//       · 「肉色」0 行（库里没这种写法）；「肤调」0 行 ⇒ 不进名单，名单只放语料里真有的词。
//     🔴 影响面与我上一版的判断相反，账记在 `21` §十二：色彩分**只吃** `top_style`／`outfit_top`
//     那一格（`recommendEngine.js:552` 认出上衣那一格、`recommend/colorSlots.js:194` 才真喂 `colorFit`（🔴 10-30 按内容重指：原写 1142；10-29 引擎拆成 961 行后 1142 越界） → `colorFit`），上面那些行全在 `reason`／`blush`／
//     `foundation`／`technique` 这些**不进分**的槽位里 ⇒ 这道闸修的是**报告与后台印出来的假出处**，
//     一个分数也不动。四个进分槽位里元词命中只有 4 处，其中 3 处是括号里真写了颜色的
//     （「基础色上衣（白/黑/灰/藏蓝/米色）」⇒ 白），那三条本轮不动（它们确实写了色）。
//     ⚠️ 这道闸**管不到元词旁边的单字键**：「肤色的粉调」挡掉「肤色」后仍能扫到「粉调」里的 粉。
//     那是"单字键长在多字词里"这一类（现量 `top_style` 11 处／`color_combo` 143 处），
//     要词边界判断才能收，本轮不做，已列进 `21` §七 待裁。
// ------------------------------------------------------------
const COLOR_META_WORDS = ['肤色', '肉色', '腮红']

/**
 * 表键里"以元词开头且比元词更长"的那些（现量只有一条：`腮红粉` #E0A3AF）。
 * 挡元词时必须先把它们让出来，否则「腮红粉」会被挡成「粉」——那是真色名，不是元词。
 * ⛔ 不手写这张表：从 `COLOR_NAME_HEX` 现算，词表以后加键它自己跟着变。
 */
const COLOR_META_LONG_KEYS = COLOR_META_WORDS.map((w) => ({
  word: w,
  keys: Object.keys(COLOR_NAME_HEX)
    .filter((k) => k.length > w.length && k.startsWith(w))
    .sort((a, b) => b.length - a.length),
}))

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

// ------------------------------------------------------------
// 3. 肤色档 → 代表 CIELAB（表单只有 8 个中文档，没有逐人实测色值）
//    🟢 10-29 重锚定（S1 样本扩容）：从"内部标定手拍值"升级为【B 档·人群实测分位】——
//    出处＝docs/依据/papers/人体肤色数据库（2025年版，CIE 2562025）.xlsx，族群＝CN 子集
//    3,555 行／404 人，按人聚合（同一受试者多部位取均值，h 由 atan2(meanB,meanA) 重算）；
//    分位口径与落位核对见 docs/依据/04 §1.4，提取工装与全部统计留痕在
//    盘外 E:\website\站3产生临时文件\skin-exp\extract.mjs → cn-person-anchors.json。
//    逐档子样出处（n＝该子样人数）：
//      白皙  ＝中性 h 人群 L 前 10% 中位（n=11）     旧值 L68 在 P95=65.87 之上＝外推，已纠正
//      自然白＝中性 h 人群 L 前 20~30% 中位（n=11）
//      冷皮  ＝冷色相子样（h<P25=52.86，n=24）中位
//      自然  ＝全体 P50（n=404）
//      暖皮  ＝暖色相子样（h>P75=64.02，n=12）中位
//      偏黄  ＝暖子样中 b 最高四分位中位（n=3；黄＝b 高，旧值 b25 高于人群 P95=21.56，已纠正）
//      小麦色＝全体 P10
//      古铜色＝最深 5 人中位（L 47.77~50.79 那一撮；旧值 L38 在 P1 之下＝外推，已纠正）
//    ⚠️ 两条实测事实，不许再退回"越深越暖"的手拍格局：
//      ① 最深人群（≈P1~P2）的 h 全部落在中性区（54.9~59.9），不暖 ⇒ 小麦色/古铜色 h 归"自然"档
//         是数据原样，不是 bug（docs/依据/04 §1.4 落实记录）；
//      ② 冷子样偏暗（L55.26）、暖子样偏亮（L61.53）⇒ 冷暖轴与深浅轴在人群里本来就拧着，
//         冷暖档的 L 不排队、不强迫单调。
//    仍不许对外称"测色仪实测"：这是文献汇编的人群分位，不是给这个顾客测出来的值。
// ------------------------------------------------------------
const SKIN_TONE_ANCHORS = {
  白皙: { L: 65.42, a: 10.31, b: 16.9 },
  自然白: { L: 63.33, a: 10.56, b: 17.9 },
  冷皮: { L: 55.26, a: 13.29, b: 16.9 },
  自然: { L: 58.53, a: 10.27, b: 16.77 },
  暖皮: { L: 61.53, a: 8.23, b: 17.41 },
  偏黄: { L: 60.57, a: 8.91, b: 19.48 },
  小麦色: { L: 54.1, a: 13.05, b: 18.57 },
  古铜色: { L: 49.51, a: 12.85, b: 20.46 },
}

/** 肤色档 → Lab；拿不到返回 null */
function skinToneToLab(skinTone) {
  if (!skinTone) return null
  const s = String(skinTone).trim()
  const direct = ownValue(SKIN_TONE_ANCHORS, s)
  if (direct) return direct
  const hit = Object.keys(SKIN_TONE_ANCHORS).find((k) => s.includes(k))
  if (hit) return SKIN_TONE_ANCHORS[hit]
  const lab = hexToLab(resolveColor(s))
  return lab || null
}

// ------------------------------------------------------------
// 3b. 肤色色相角（冷暖轴）判据 —— 第十阶段·第一步（docs/依据/18 §2.2）
//     切点＝华裔人群 h° 的 P25＝52.86 与 P75＝64.02（【B 档·人群参照】，
//     尺子与行数见 docs/依据/04 §1.4：族群列＝CN 的 3,555 行／404 人）。
//     🔴 **拿分位点当判据切点这件事本身是 C 档·本站自拟**：人群分布只说明
//     "这个人站在哪儿"，不规定"站那儿就该穿什么"；对外不许说"按实测分档"。
//     ⛔ 只吃色相角、⛔ 不吃绝对明度：Alipour 2026（DOI 10.1111/srt.70374，
//     档位【二手】）实测非受控成像下固定阈值 ITA 分型准确率 22.9% ＜ 基线 51.3%
//     （`docs/依据/02` §2 第 4 条），⇒ 照片来的 L* 不是肤色。
//     现量反例（盘外工装 phase10-20261021/cut-selfcheck.cjs）：一块典型"亮皮肤"
//     sRGB #E8C4B8 经 hexToLab 得 **L=81.89**，比华裔 P95＝65.87 还高 16 个点。
//     深浅那一轴（白皙/自然白/偏黄/小麦色/古铜色）因此**只能用户照镜子自己选**，
//     本函数从不返回它。
// ------------------------------------------------------------
const SKIN_HUE = {
  /** 华裔 h° P25 ⇒ 到此为止算冷皮（B 档人群分位＋C 档切法） */
  cold: 52.86,
  /** 华裔 h° P75 起算暖皮 */
  warm: 64.02,
  /** 闸下沿＝华裔 P5(44.36) − 8；外扩 8 是 C 档手拍 */
  min: 36.36,
  /** 闸上沿＝华裔 P95(70.05) ＋ 8；外扩 8 是 C 档手拍（10-29 前注释拿"偏黄锚点 h=74.36 在 P95 之外"当理由，
      重锚定后锚点 h 全部 ≤65.42，那条理由作废——闸界包的是**照片取色角度**的人群余量，不是锚点） */
  max: 78.05,
}

/**
 * 色相角 → 冷暖档名（站内唯一口径；配饰/妆容那两条 `includes()` 消费路只认这三个词）。
 * @param {number|string} hue 色相角（度）
 * @returns {'冷皮'|'自然'|'暖皮'|null} 非有限数或过不了 h 闸 ⇒ **null**，⛔ 不退回"自然"
 */
function skinUndertoneFromHue(hue) {
  const h = Number(hue)
  if (!Number.isFinite(h)) return null
  if (h < SKIN_HUE.min || h > SKIN_HUE.max) return null
  if (h <= SKIN_HUE.cold) return '冷皮'
  if (h >= SKIN_HUE.warm) return '暖皮'
  return '自然'
}

/** 华裔人群 L* 实测范围（docs/依据/04 §1.4：族群列＝CN 的 P5/P95），用于把用户深浅滑块映射到连续 L* */
const SKIN_L_RANGE = { p5: 51, p95: 66 }

/**
 * 深浅档名 + 取色角度 + 用户自选深浅 → 进 `colorFit` 的那个 Lab（18 §2.5 那条合成的**唯一实现处**）。
 *
 * 🔴 为什么放在 `colorMetrics.js` 而不是引擎里：规范 §2.5 原写"收成 `recommendEngine.js` 的一个
 * helper"，但 10-21 写码时现量到**第五处取值点**在 `services/topFromBody.js:379`（上衣处方第 2 层
 * 颜色，就是顾客在报告里看到的那串"更分离/更分不开"）。它不吃引擎，只吃 `topSpec(enriched)` 传进来的
 * 画像。⇒ 合成逻辑收不进引擎那一个 helper，只能收到这个**两边都 require 得到的模块**里，
 * 否则照片角度改了名次却不改建议色，正是本轮目标（"根据肤色推荐更合适的颜色"）要修的那件事。
 * 这条订正连同现量数字记进 18 §九。
 *
 * @param {string|null} toneText 深浅/冷暖档名（按 enriched.skin_tone_detail || skin_tone 的既有优先级传进来）
 * @param {number|string|null|undefined} hue 照片取色的色相角（度）；⛔ 客户端递不进 Lab
 * @param {number|string|null|undefined} [lightness01] 用户自选深浅 0~1（0＝最暗，1＝最亮）；
 *        来自 `skin_lightness` 滑块（0~100）。提供时 L 从华裔 P5~P95 线性映射，不再用锚点的 L。
 *        ⛔ 这仍然是用户照镜子自选，不是照片明度，不违反"深浅只认档名锚点"那条硬规矩。
 * @returns {{lab:{L:number,a:number,b:number,C:number,h:number}, undertone:'冷皮'|'自然'|'暖皮'}|null}
 *          档名认不出 或 角度过不了闸 ⇒ null（调用方回退到档名锚点，⛔ 不编值）
 */
function synthesizeSkinLab(toneText, hue, lightness01) {
  const anchor = skinToneToLab(toneText)
  if (!anchor) return null
  const undertone = skinUndertoneFromHue(hue)
  if (!undertone) return null
  const h = Number(hue)
  if (h < SKIN_HUE.min || h > SKIN_HUE.max) return null
  // ⚠️ C 一律取自锚点（C 档手拍表），照片**只贡献角度**。
  // ⛔ 不许把 C 写回 SKIN_TONE_ANCHORS：那是模块级共享常量，写一次污染之后每一次取色。
  const C = Math.hypot(anchor.a, anchor.b)
  // L：用户自选深浅优先（连续值），否则用锚点 L（离散档）
  const ln = Number(lightness01)
  let L = anchor.L
  if (Number.isFinite(ln) && ln >= 0 && ln <= 1) {
    L = SKIN_L_RANGE.p5 + ln * (SKIN_L_RANGE.p95 - SKIN_L_RANGE.p5)
  }
  const rad = (h * Math.PI) / 180
  return {
    lab: { L, a: C * Math.cos(rad), b: C * Math.sin(rad), C, h },
    undertone,
  }
}

// ------------------------------------------------------------
// 4. 上衣 × 人 的贴合分（合成分权重＝C 档手拍值，等 F7 的标注回归出来后替换）
// ------------------------------------------------------------
const _clamp01 = (v) => Math.max(0, Math.min(1, v))
/** 从"珊瑚粉、蜜桃色针织衫"这类结论文本里认第一个出现的色名（认不出返回 null） */
const _matchedColorName = (input) => {
  const s = String(input || '')
  if (ownValue(COLOR_NAME_HEX, s)) return s
  return _firstColorNameIn(s)
}
const WEIGHTS = { hueContrast: 0.45, brighten: 0.35, chromaMatch: 0.2 } // 手拍，未回归（C 档）

/**
 * 无彩色判定线（10-19 现量，判据见下）。
 * COLOR_NAME_HEX 58 个色名里 C<5 的正好 9 个：白、黑、墨黑、浅灰、中灰、冷灰、枪灰、银灰、银色
 * ——全是本来就没有色相的那一批；往上第一个是 米白 C5.4（带暖调的白，该留在有色相侧）。
 * 肤色侧 8 档锚点最低的是 白皙 C16.1，全部远在条线之上 ⇒ 这条线只裁得到衣服侧。
 *
 * **10-20 第六阶段·第一步复量（词表 58⇒232 键之后，同一把尺子）：**
 * C<5 的键从 9 个涨到 **36 个**，全是本来就没有色相的那一批：
 * 白色/黑色/墨黑/浅灰/中灰/冷灰/枪灰/银灰/银色/纯白/本白/珍珠白/云白/骨白/暖白/冷白/粉白/银白/
 * 炭灰/烟灰/石灰/水泥灰/雾灰/雾霾灰/中性灰/深灰/铁灰/石墨色/炭黑/哑光黑/乌黑/莫兰迪/银/灰/白/黑。
 * 条线上方最近的两名换人了：**象牙白 C5.2、蛋壳色 C5.2**（原读数"第一个是米白 C5.4"作废——
 * 米白 C5.4 还在，只是排到第三，同档还有 陨石灰 5.4、大象灰 5.4）。
 * 肤色侧一个键没动，最低仍 白皙 C16.1 ⇒ "这条线只裁得到衣服侧"仍然成立。
 * ⇒ 条线本身**没挪**（仍 5），挪的是名单长度；`test/colorMetrics.test.js` 里那处写死的 9×8=72
 *   已改成"按 C<ACHROMATIC_C 现算 × 肤色档数"，以后再扩表不咬测试。
 *
 * 为什么要裁：`_hueAngle` 是 atan2(b,a)，无彩色 a=b=0 ⇒ atan2(0,0)=0 度＝正红。
 * 于是"黑上衣"对谁都被算成色相角 0°，hueContrast 这一轴拿到的是一个**假数**，
 * 而它占总分 45%。10-19 接入 ΔE00 时发现这条假轴一直在给无彩色上衣发色相分。
 */
const ACHROMATIC_C = 5

/**
 * 同色糊合闸门。ΔE00 与三轴同源（都是 Lab 差），把它当第四轴加一遍＝同一信息收两遍钱；
 * 但它手里有一件三轴都看不到的事：上衣和脸**几乎同一个色**时，对比与提亮都不成立，人糊成一片。
 *
 * **10-19 第二阶段改切点（产品决定，由用户拍）：`{lo:6,hi:15}` → `{lo:15,hi:30}`。**
 * 改前它在真实推荐里**一次没触发**（判据见 `docs/依据/11` §五 的覆盖率账：矩阵穿搭里 ΔE00<15 的 0 条），
 * 等于接了根空线。门槛仍取本库实测分布，不引外部 JND 阈值（本机没有可觉差原文，不许假装有出处）：
 *   8 档肤色锚点 × 58 色名 = 464 对（10-19 复量，本轮重跑同一把尺子）：
 *   ΔE00<6 的 5 对（1.1%）／6~15 的 45 对（9.7%）／**15~30 的 259 对（55.8%）**／≥30 的 155 对（33.4%）；
 *   分位 p05=10.9、p10=14.7、**p50=26.1**。
 * ⇒ 新口径：15 以下吃满惩罚 0.85，15~30 线性回到 1.0，30 以上一律不动。
 * ⚠️ 覆盖面从 10.8% 涨到 **66.6%**（<15 的 50 对 + 15~30 的 259 对），中位那一对被扣约 5.6%——
 *   它因此不再是"只裁极端糊色"的例外条款，而是**普遍参与缩放的第三笔账**；惩罚上限仍锁 0.85（最多扣 15%），
 *   所以它只能挪名次、不能推翻对比侧。这句是本轮改动的代价，对外要说，不能只说"闸门修好了"。
 *
 * **10-20 第六阶段·第一步复量（词表 232 键，8 档肤色 × 232 色名 = 1856 对；上面 464 对那组读数保留不改）：**
 *   ΔE00<6 的 14 对（0.8%）／6~15 的 179 对（9.6%）／**15~30 的 885 对（47.7%）**／≥30 的 778 对（41.9%）；
 *   分位 p05=12.0、**p50=27.9**、p95=45.5。覆盖面（<30 的两段相加）**66.6% ⇒ 58.1%**。
 *   中位那对实际被乘的闸门值现量：新表 ΔE00 27.9 ⇒ gate 0.979（扣 2.1%）；
 *   旧表 26.1 ⇒ gate 0.961（扣 3.9%）。扩表后平均力道反而轻了，因为新增的流行色大多不在糊色区。
 *   ⇒ 结论：**切点 15/30 不动**。理由是这两组读数的 p50 都落在 15~30 段内、且 15~30 都占了将近一半，
 *     换切点等于拿新分布再调一次产品参数，而本轮的目标是"认得出更多色"，不是"重排分数"。
 *     要重切的话必须先有反馈数据（feedback_events 现在 0 行），不能凭分布好看。
 */
const FUSION_GATE = { lo: 15, hi: 30, min: 0.85 }

/**
 * 呼应侧在总分里的份额（手拍，C 档）。
 * 两个数在返回值里各自留着（contrast_score 与 harmony_score），任何一条推荐都能拆回账——
 * 这是 08 §8.2「改之前先攒标注，别连着改两处导致分数没法归因」要求的写法。
 */
const HARMONY_SHARE = 0.3

/** @param {number} dE 上衣与肤色的 ΔE00 @returns {number} 0.85~1.0 的乘数 */
function fusionGate(dE) {
  const e = Number(dE)
  if (!Number.isFinite(e)) return 1
  if (e <= FUSION_GATE.lo) return FUSION_GATE.min
  if (e >= FUSION_GATE.hi) return 1
  const t = (e - FUSION_GATE.lo) / (FUSION_GATE.hi - FUSION_GATE.lo)
  return FUSION_GATE.min + t * (1 - FUSION_GATE.min)
}

/** 呼应侧混分：对比分（或明度档分）与整身呼应分按 HARMONY_SHARE 加权，两个分量都留在返回里 */
function _blendHarmony(contrastScore, opts) {
  const harmonyRaw =
    opts && opts.harmony !== undefined && opts.harmony !== null ? Number(opts.harmony) : NaN
  const harmony = Number.isFinite(harmonyRaw) ? Math.max(0, Math.min(100, harmonyRaw)) : null
  return {
    harmony,
    score:
      harmony === null
        ? Math.round(contrastScore)
        : Math.round(contrastScore * (1 - HARMONY_SHARE) + harmony * HARMONY_SHARE),
  }
}

/**
 * L5 明度档口径：这一条文案**没有具体色**，只有"深色/浅色"这一档亮度。
 * 能给的只有方向（Zhang 2025 那条讲的是"衣装比脸暗 ⇒ 脸显白"，本来就不需要具体色相），
 * 所以 brighten 取档位提示值，色相轴与彩度轴各按"没有信息"记 0.5 —— 与无彩色那条同一写法。
 * ⛔ 不给 hex、不算 ΔE00、闸门不参与（没有两个 Lab 可差），
 *    并且 `basis='lightness-band'` 一路带到报告与后台，谁看到这条分都知道它是粗算的。
 * @returns {object} 与 colorFit 同形状，只是 deltaE00／dHue／dL／chroma／top_hex 为 null
 */
function _bandOnlyFit(skinLab, band, opts, input) {
  const hint = LIGHTNESS_BANDS[band].brightenHint
  const contrastScore =
    100 * (WEIGHTS.hueContrast * 0.5 + WEIGHTS.brighten * hint + WEIGHTS.chromaMatch * 0.5)
  const blended = _blendHarmony(contrastScore, opts)
  return {
    score: blended.score,
    top_hex: null,
    top_label: LIGHTNESS_BANDS[band].label,
    deltaE00: null,
    dHue: null,
    hueContrast: 0.5,
    hue_applies: false,
    dL: null,
    brighten: Math.round(hint * 100),
    chroma: null,
    fusion_gate: 1,
    contrast_score: Math.round(contrastScore * 10) / 10,
    harmony_score: blended.harmony === null ? null : Math.round(blended.harmony * 10) / 10,
    basis: 'lightness-band',
    synonym_via: _bandTokenIn(input),
    family: null,
    band,
    evidence:
      'L5 明度档：这条文案没有具体色名，只有"深/浅"这一档 ⇒ 只喂 brighten 轴（Zhang 2025 那条方向性结论），色相与彩度两轴按无信息记 0.5，无 ΔE00、无闸门。档位提示值 0.8/0.5/0.2 与切点 L≤35／L≥65 都是本工程 C 档手拍，不是文献值',
  }
}

/**
 * @param {object|string} skin 肤色档中文名、'#hex' 或 {L,a,b}
 * @param {string|object} topColor 上衣色：'#hex'／色名／含色名的文案／{L,a,b}；
 *                只含"深色/浅色"这类明度词时走 L5 明度档口径（basis='lightness-band'）
 * @param {{harmony?:number}|null} opts 整身呼应分（outfitHarmony 出的 0~100）；缺省＝这一维没数据，不参与打分
 * @returns {null|{score:number, deltaE00:number|null, dHue:number|null, hueContrast:number, dL:number|null, brighten:number, chroma:number|null, basis:string, family:string|null, band:string|null, evidence:string}}
 *          色与明度档都取不到 ⇒ 返回 null（不编造分数）
 */
function colorFit(skin, topColor, opts) {
  const rawSkin = skin && typeof skin === 'object' && 'L' in skin ? skin : skinToneToLab(skin)
  if (!rawSkin) return null
  // 肤色锚点表只存 L/a/b，这里补齐 C，避免 NaN 一路传到 score
  const skinLab = { ...rawSkin, C: Math.hypot(rawSkin.a, rawSkin.b) }
  // 10-13 那条实测仍然成立：colorFit({L:60}, '#FFCC00')（a/b 缺 ⇒ C 算不出）回 null，
  // 不是回 score=NaN；守的就是下面这两行有限性检查。
  if (!isFinite(skinLab.L) || !isFinite(skinLab.C)) return null

  // top 侧三条入口（10-20 第六阶段·第一步）：
  //   ① {L,a,b} 对象；② hex／色名／含色名的文案（走五步归一链）；③ 只有明度词 ⇒ L5 档口径。
  // ⚠️ ①这条是**本轮才真的通**：改前写法是 `resolveColor(topColor)`，
  //    对象进来被 String() 读成 '[object Object]' ⇒ 返回 null ⇒ 整条 colorFit 直接 null，
  //    而注释却写着"签名允许调用方直接把 {L,a,b} 递进来"。现在按对象入口单独处理，
  //    并且不改调用方传进来的对象——SKIN_TONE_ANCHORS 是模块级共享常量，往里写 C 会污染后续每一次取色。
  const topIsLab = !!(topColor && typeof topColor === 'object' && 'L' in topColor)
  const detail = topIsLab
    ? { key: null, hex: null, lab: topColor, basis: 'lab-object', via: null }
    : _resolveDetailed(topColor)
  // 认不出色、又不含明度词 ⇒ 返回 null（规范 `14` §三/§五：不编分），调用方按 `if (fit)` 处理。
  // ⚠️ 这里加 `!detail ||` 是**防御性的，不是修 bug**：10-20 第六阶段·第一步我一度以为
  //    这一行会抛 TypeError，现量证明**不是**——`_resolveDetailed` 认不出时回的是
  //    `none = {key:null,hex:null,lab:null,basis:null,via:null}` 这个**对象**（`:719`），永远不是
  //    null，所以改前改后 13 组垃圾入参（''／null／'乱写的词'/'#ZZZ123'/全角 hex/123/{}/[]/…）
  //    **都回 null、一个没抛**。当时那句 "Cannot read properties of null (reading 'basis')"
  //    是我自己的探针在 null 返回值上读 `.basis` 抛的，不是模块抛的（账在 `14` §9.7）。
  // 🔴 §二·1：`detail.craft` 为真＝这个"颜色"是从句子里扫到的**工艺词**（牛仔／水洗／迷彩），
  //    它指的是面料处理方式，不是这件衣服的颜色。取到 hex 只为审计，⛔ 不许喂 ΔE00——
  //    一条「蓝色牛仔外套」里"蓝色"是具体色、"牛仔"是工艺；反过来光秃秃一句「牛仔短裤」
  //    在色彩这一维就是**缺测**，按硬规矩 2 回 null 或走明度档，不许凭空出一个贴合分。
  //    （边界：用户在自己衣橱里手打「牛仔」是 `basis='synonym'` 那条来路，不算工艺词，照常出分。
  //     与 §二·2 的手选／自由文案口径一致；这条偏差记进 `21` §十二。）
  if (!detail || !detail.lab || detail.craft) {
    const band = _bandOfText(String(topColor || ''))
    if (!band) return null
    return _bandOnlyFit(skinLab, band, opts, String(topColor || ''))
  }
  const topLabRaw = detail.lab
  if (!topLabRaw || !isFinite(topLabRaw.L)) return null
  const topC = isFinite(topLabRaw.C) ? topLabRaw.C : Math.hypot(topLabRaw.a, topLabRaw.b)
  if (!isFinite(topC)) return null
  const topLab = { ...topLabRaw, C: topC }

  const dE = deltaE00(skinLab, topLab)
  const dHue = hueGap(skinLab, topLab)
  const dL = topLab.L - skinLab.L
  const dC = topLab.C - skinLab.C
  // 无彩色那一侧色相角是 atan2(0,0) 造出来的假数 ⇒ 这一轴按"没有信息"记 0.5（它的最小值），
  // 而不是把 45% 的权重摊给剩下两轴——摊过去等于把假色相的收益转给明度轴，黑上衣会凭空涨分。
  const hueApplies = skinLab.C >= ACHROMATIC_C && topLab.C >= ACHROMATIC_C
  const hueContrastRaw = 0.5 + _clamp01(dHue / 360) // Schloss & Palmer 第②句：图形色(衣)对背景(脸)，色相差越大越被偏好
  const hueContrast = hueApplies ? hueContrastRaw : 0.5
  // 🔴 S1（10-19 蓝图短期项，10-23 落）：分母 40⇒80 且**中心化 0.5**。只改分母过不了蓝图自己的
  // 验收（61% 的配对卡的是 0 端：衣服只要不比脸暗就恒 0，分母动它一个都不降），必须把"同明度"
  // 从 0 分挪成 0.5 中性——方向仍是 Zhang 2025"衣装越暗脸越显白"，暗 40⇒趋 1、亮 40⇒趋 0，
  // 中段由 dL 连续区分（改前白/亮黄/浅粉在这轴恒同分）。⛔ 别抄旧文档里的 "/40"。
  const brighten = _clamp01(0.5 + (skinLab.L - topLab.L) / 80)
  const chromaMatch = 1 - _clamp01(Math.abs(dC) / 60)
  const gate = fusionGate(dE)
  const contrastScore =
    100 *
    (WEIGHTS.hueContrast * hueContrast +
      WEIGHTS.brighten * brighten +
      WEIGHTS.chromaMatch * chromaMatch) *
    gate
  // 呼应侧：整身单品两两 ΔE00 的面积加权相似度（outfitHarmony 出数）。
  // 这一维与上面那三维**不同源**：三维量的是"这件衣服 vs 这张脸"，呼应量的是"衣服之间互相"，
  // 加进来不是把同一个 Lab 差收两遍钱。分数拆开存（contrast_score / harmony_score）以便归因。
  const blended = _blendHarmony(contrastScore, opts)
  return {
    score: blended.score,
    top_hex: detail.hex,
    top_label:
      detail.key ||
      _matchedColorName(topColor) ||
      // {L,a,b} 对象进来时 String() 会读成 '[object Object]'，报告/后台照印就是乱码
      (topIsLab
        ? `Lab(${Math.round(topLab.L)}, ${Math.round(topLab.a)}, ${Math.round(topLab.b)})`
        : String(topColor).slice(0, 12)),
    deltaE00: Math.round(dE * 10) / 10,
    dHue: Math.round(dHue * 10) / 10,
    // 对比轴归一后的贡献值 0.5~1.0（Δhue 0°→0.5，180°→1.0）。
    // 区间只有一半宽度是文档 §8.2 定下的写法：它保证"色相无 separation"不至于被判成 0 分。
    // ⚠️ 无彩色时这里回的是"按没有信息记账"的 0.5，判据看 hue_applies 这个布尔。
    hueContrast: Math.round(hueContrast * 1000) / 1000,
    hue_applies: hueApplies,
    dL: Math.round(dL * 10) / 10,
    brighten: Math.round(brighten * 100),
    chroma: Math.round(topLab.C * 10) / 10,
    // ΔE00 闸门与两个分量的实际值：报告与后台要把总分拆回这两笔账时，靠这三个字段就够
    fusion_gate: Math.round(gate * 1000) / 1000,
    contrast_score: Math.round(contrastScore * 10) / 10,
    harmony_score: blended.harmony === null ? null : Math.round(blended.harmony * 10) / 10,
    // 10-20 第六阶段·第一步新增的三个审计字段：这条分是"凭什么认出的色"必须可查。
    // basis：hex／table-key／strip-color／add-color／synonym／in-text／lab-object／lightness-band
    // synonym_via：走了同义词库时记下的是**哪个别名**（前台要显示"咖啡色→咖啡棕"时有据）
    // family／band：色系与明度档（L4/L5 软标签，不进这条分，只供分组与文案）
    basis: detail.basis,
    synonym_via: detail.via,
    family: colorFamily(topColor),
    band: bandOfLab(topLab),
    evidence:
      'A 色差公式(GB/T 7921 / ISO-CIE 11664) + B 色相对比与明度效应(Schloss & Palmer 2011 图形色-背景那句 + Zhang 2025, DOI 见文件头) + C 三轴权重与呼应份额(手拍，未回归)；ΔE00 只当同色糊合闸门用（切点 15/30 取本库分布，非文献 JND；词表 232 键下现量 1856 对：<15 193 对 10.4%、15~30 885 对 47.7%、≥30 778 对 41.9%，覆盖面 58.1%）',
  }
}

/**
 * 面积权重取值口径：正数照用，**0 也照用**（0 表示这件不占面积，比如只当存在不算比重的配饰），
 * 只有 NaN／负数／没填才回退成 1（等同"未知，按平均一件算"）。
 * 原来两处写成 `Number(p.area) || 1`，`||` 会把合法的 0 一起吞掉 ⇒ 明确写 0 的单品
 * 被当成和平均一件一样重，加权结果和调用方给的面积比例相反。
 * @param {*} v parts 里的 area 原值
 * @returns {number}
 */
function areaWeight(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

/**
 * 整身配色和谐度：两两 ΔE00 按面积乘积加权（60-30-10 那类比例在这里体现为面积权重）
 * @param {Array<{label:string,color:string,area:number}>} parts 面积和不必为 1，会自动归一
 * @returns {null|{score:number, pairs:Array}}
 */
function outfitHarmony(parts) {
  const list = (parts || [])
    .map((p) => ({ ...p, lab: hexToLab(resolveColor(p.color)), weight: areaWeight(p.area) }))
    .filter((p) => p.lab)
  if (list.length < 2) return null
  let total = list.reduce((s, p) => s + p.weight, 0)
  // 全 0（调用方把所有件都标成不占面积）⇒ 归一化会 0/0，退化成等权
  if (!(total > 0)) {
    list.forEach((p) => {
      p.weight = 1
    })
    total = list.length
  }
  const pairs = []
  let num = 0
  let den = 0
  let simSum = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const w = (list[i].weight / total) * (list[j].weight / total)
      const sim = 100 - Math.min(deltaE00(list[i].lab, list[j].lab), 100)
      num += w * sim
      den += w
      simSum += sim
      pairs.push({
        a: list[i].label,
        b: list[j].label,
        deltaE00: Math.round(deltaE00(list[i].lab, list[j].lab) * 10) / 10,
      })
    }
  }
  // 只剩一对且它权重为 0（另一件面积是 0）时 den 也是 0 ⇒ 同样按等权均值出分，不给 NaN
  const value = den > 0 ? num / den : simSum / pairs.length
  return { score: Math.round(value * 10) / 10, pairs }
}

module.exports = {
  hexToLab,
  deltaE00,
  hueGap,
  individualTypologyAngle,
  itaClass,
  resolveColor,
  normalizeColorName,
  extractColors,
  colorFamily,
  lightnessBand,
  bandOfLab,
  skinToneToLab,
  skinUndertoneFromHue,
  synthesizeSkinLab,
  SKIN_HUE,
  colorFit,
  outfitHarmony,
  fusionGate,
  ACHROMATIC_C,
  FUSION_GATE,
  HARMONY_SHARE,
  WEIGHTS,
  COLOR_NAME_HEX,
  COLOR_SYNONYMS,
  // 第十三阶段·第一步 §二·2：元词黑名单导出给单测与报告用（⛔ 别处不许再抄一份名单）
  COLOR_META_WORDS,
  // 第十三阶段·第一步 §二·1：工艺词与"句内扫描要走的别名表"同样只有一份真相源
  COLOR_CRAFT_WORDS,
  COLOR_ALIAS_SCAN_TOKENS,
  COLOR_ANTI_SYNONYMS,
  COLOR_FAMILY_WORDS,
  COLOR_FAMILY_OVERRIDES,
  COLOR_HSL_FAMILY_BANDS,
  LIGHTNESS_BANDS,
  LIGHTNESS_TOKENS,
  SKIN_TONE_ANCHORS,
}
