/**
 * 穿搭日记的"哪天穿的＋那天多冷"三格校验（2026-10-21 第十一阶段·第一步）
 * ============================================================
 * 规范出处：`docs/依据/19-穿搭日记与天气输入输出规范-20261021.md` §三。本文件是它的实现，两边同轮改。
 *
 * 为什么单独成一个 utils：这三格同时被 **POST /outfits、PUT /outfits** 两条写入口吃，
 * 还要被 `services/wearPreference.js`（读侧）与回归脚本认同一个口径。
 * ⛔ 值表不在这里抄第二份：天气五档的唯一真相源是 `services/weatherService.js` 的
 * `WEATHER_LEVELS`/`levelFromFeelsLike`（19 §三 第 1 条），这里只做"请求里的东西能不能进库"这一道判。
 *
 * 三态口径继承 `docs/依据/18` §三（与 `item_feedback` 那套一致）：
 *  - `undefined`＝请求里没提这一格 ⇒ **保持库里原值不动**（PUT 半更）；
 *  - `null`／空串＝明确要求清空 ⇒ 落 NULL；
 *  - 有值 ⇒ 过本文件的校验，不过就 400 说破，⛔ 不许静默落成 NULL"当没事发生"。
 */
const { levelFromFeelsLike, WEATHER_LEVELS } = require('../services/weatherService')
const { asText } = require('./common')
const { beijingDateStr } = require('./beijingTime')

/** 日期下限：本项目没有任何早于此的穿着史，写这么早基本都是键盘误触（19 §三 第 2 条） */
const MIN_WEAR_DATE = '2015-01-01'

/** 体感温度的合理量程（℃）。超出＝不是打字错就是拿别处的数凑（19 §三 第 3 条） */
const FEELS_LIKE_MIN = -60
const FEELS_LIKE_MAX = 60

/** 空串/纯空格＝"清空这一格"，与 `null` 同义（前端把 `<input type="date">` 清空就是空串） */
const isClear = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/**
 * 今天的日历日（`YYYY-MM-DD`，**按东八区**判，不看服务器在哪个时区）。
 * 🔴 口径不另起一份：直接走 `utils/beijingTime.js` 的 `beijingDateStr()`——那个文件的头注逐字写着
 * "凡是要写进协议字段、缓存键、或给用户看的『今天』，一律走这里的函数"，⛔ 本文件不许自己再 `Intl` 一遍。
 * （历史：10-21 第十一阶段·第一版这里写的是 `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'})`，
 * 功能正确但是**第二把尺子**，07:2x 自查时收成 `beijingDateStr()`；两把尺子在本机同日实测输出逐字相同，
 * 但容器 TZ 一旦不是 UTC+8，只有 `beijingTime` 那一条路是靠得住的。）
 */
function todayShanghai() {
  return beijingDateStr()
}

/** 逐字判一个 `YYYY-MM-DD` 是不是真实存在的日历日（含闰年与大小月） */
function parseWearDate(raw) {
  const s = asText(raw)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  // 2 月 30 日这类会被 Date 顺延成 3 月：回读年月日对不上就是假日期
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return s
}

/**
 * `wear_date` 一格的读法。
 * @returns {{ok:true, value:string|null}|{ok:false, error:string}}
 */
function readWearDate(raw) {
  if (isClear(raw)) return { ok: true, value: null }
  const s = parseWearDate(raw)
  if (!s) {
    return {
      ok: false,
      error:
        'wear_date 必须是 YYYY-MM-DD 这样的真实日期（现在收到的是 ' +
        JSON.stringify(asText(raw)).slice(0, 30) +
        '）',
    }
  }
  if (s < MIN_WEAR_DATE)
    return { ok: false, error: `wear_date 太早了（不早于 ${MIN_WEAR_DATE}）：${s}` }
  const today = todayShanghai()
  if (s > today)
    return { ok: false, error: `wear_date 不能是未来：今天（东八区）是 ${today}，收到的是 ${s}` }
  return { ok: true, value: s }
}

/** `feels_like_c` 一格的读法（⛔ 空串不当 0℃，那是"今天 0 度"不是"没填"） */
function readFeelsLike(raw) {
  if (isClear(raw)) return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : Number(asText(raw))
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      error:
        'feels_like_c 只能是一个数字（摄氏度），现在收到的是 ' + JSON.stringify(raw).slice(0, 30),
    }
  }
  if (n < FEELS_LIKE_MIN || n > FEELS_LIKE_MAX) {
    return {
      ok: false,
      error: `feels_like_c 要在 ${FEELS_LIKE_MIN} ~ ${FEELS_LIKE_MAX}℃ 之间，收到的是 ${n}`,
    }
  }
  return { ok: true, value: Math.round(n * 10) / 10 }
}

/** `weather_level` 一格的读法：只收那五个词，表外词 400（采了也命不中任何算式＝白采） */
function readWeatherLevel(raw) {
  if (isClear(raw)) return { ok: true, value: null }
  const s = asText(raw)
  if (!WEATHER_LEVELS.includes(s)) {
    return {
      ok: false,
      error: `weather_level 只能是 ${WEATHER_LEVELS.join('/')} 之一，收到的是「${s.slice(0, 20)}」`,
    }
  }
  return { ok: true, value: s }
}

/**
 * 一次读完三格并过一致性闸门（19 §三 第 5 条）。
 * 为什么必须有这道闸：前端既可能"按城市取今天天气"自动填、又可能用户手选档，
 * 两条路各填一半就会造出"体感 30℃ 却写着寒冷"这种**永远学不出东西**的行——
 * 与其让偏好层日后对着它猜，不如写入口当场 400 说破。
 * ⛔ 不许以"用户手选的档优先"名义静默改写任何一格。
 * @param {object} data 请求体（只认这三个键，其它键一律不看）
 * @returns {{ok:true, fields:{wear_date:string|null, feels_like_c:number|null, weather_level:string|null}}|{ok:false, error:string}}
 */
function readOutfitWeather(data) {
  const body = data && typeof data === 'object' ? data : {}
  const d = readWearDate(body.wear_date)
  if (!d.ok) return d
  const t = readFeelsLike(body.feels_like_c)
  if (!t.ok) return t
  const l = readWeatherLevel(body.weather_level)
  if (!l.ok) return l
  if (t.value !== null && l.value !== null) {
    const derived = levelFromFeelsLike(t.value)
    if (derived !== l.value) {
      return {
        ok: false,
        error: `体感 ${t.value}℃ 按本系统的口径应该算「${derived}」，与填的「${l.value}」不一致；要么改温度要么改档，⛔ 两格不能各说一套`,
      }
    }
  }
  return {
    ok: true,
    fields: { wear_date: d.value, feels_like_c: t.value, weather_level: l.value },
  }
}

/**
 * PUT 半专用：只把请求里**提到过**的键挑出来当补丁（`undefined`＝不动，其余走同一把校验尺子）。
 * 一致性闸门在补丁上做**合并后**的判断：这次没提的那一格要拿库里的现值一起比，
 * 否则"只改温度不改档"会绕过闸门把那一行拆成两半。
 * @param {object} data 请求体
 * @param {{wear_date?:string|null, feels_like_c?:number|null, weather_level?:string|null}} existing 库里那一行
 * @returns {{ok:true, patch:Array<[string, any]>}|{ok:false, error:string}}
 */
function readOutfitWeatherPatch(data, existing) {
  const body = data && typeof data === 'object' ? data : {}
  const before = existing || {}
  const keys = ['wear_date', 'feels_like_c', 'weather_level'].filter((k) => body[k] !== undefined)
  if (keys.length === 0) return { ok: true, patch: [] }
  const one = readOutfitWeather(body)
  if (!one.ok) return one
  const merged = {
    wear_date: body.wear_date !== undefined ? one.fields.wear_date : (before.wear_date ?? null),
    feels_like_c:
      body.feels_like_c !== undefined ? one.fields.feels_like_c : (before.feels_like_c ?? null),
    weather_level:
      body.weather_level !== undefined ? one.fields.weather_level : (before.weather_level ?? null),
  }
  const after = readOutfitWeather(merged)
  if (!after.ok) return after
  return { ok: true, patch: keys.map((k) => [k, one.fields[k]]) }
}

module.exports = {
  MIN_WEAR_DATE,
  FEELS_LIKE_MIN,
  FEELS_LIKE_MAX,
  todayShanghai,
  parseWearDate,
  readWearDate,
  readFeelsLike,
  readWeatherLevel,
  readOutfitWeather,
  readOutfitWeatherPatch,
}
