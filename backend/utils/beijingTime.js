/**
 * 北京时间工具（与容器时区解耦）
 * ============================================================
 * 站3 的容器没设 TZ，实测 `date` 回 UTC ⇒ 任何 `getFullYear()/getHours()/toISOString()`
 * 读出来的都是 UTC，不是顾客所在的那一天。已知的三类后果：
 *  - 支付宝/微信那两枚时间戳：支付宝明文要求 timestamp 用东八区，UTC 就恒早 8 小时；
 *  - 星座运势的"今天"：北京时间 00:00~07:59 之间取到的是**昨天**的日期，
 *    缓存键也跟着错，早上看到的"今日运势"其实是昨天那份；
 *  - 季节判定：3 月/6 月/9 月/12 月的头 8 小时会被算成上一季。
 *
 * 所以凡是要写进协议字段、缓存键、或给用户看的"今天"，一律走这里的函数，
 * 不要再直接读本地时间。
 */

const TZ = 'Asia/Shanghai'

/** 用 Intl 按东八区拆出年月日时分秒（不依赖容器 TZ，也不依赖系统时钟是 UTC 还是本地） */
function beijingParts(at = new Date()) {
  // locale 里写死 hourCycle=h23：en-GB 的默认小时制是"环境约定"，
  // 一旦 ICU 把它改成 h24，午夜那一小时会给出 day=前一天 + hour='24'，
  // 而下面那个 '24'→'00' 的兜底只改时不改日 ⇒ 日期整段错一天，
  // 支付宝的 timestamp/单号前缀、运势缓存键都跟着错。
  // 10-13 实测（本机与容器同为 Node v24.20.0）：2000 个抽样时刻下
  // 'en-GB' 与 'en-GB-u-hc-h23' 的 formatToParts 逐字段全等，且没有一次回 '24'
  // ⇒ 这次改动今天不改任何输出，只是把"默认值"变成"写死的值"。
  const parts = new Intl.DateTimeFormat('en-GB-u-hc-h23', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (type, w = 2) => {
    const found = parts.find((x) => x.type === type)
    if (!found) return '0'.repeat(w)
    // 保险丝：小时制已被上面写死，正常不会走到；真出现 '24' 说明运行时的 ICU 变了
    return type === 'hour' && found.value === '24' ? '00' : found.value
  }
  return {
    year: get('year', 4),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** 'YYYY-MM-DD'：给"今天"、缓存键、对外的日期列 */
function beijingDateStr(at) {
  const p = beijingParts(at)
  return `${p.year}-${p.month}-${p.day}`
}

/** 'YYYYMMDDHHMMSS'：给支付宝/微信那种紧凑时间戳与单号前缀 */
function beijingStamp(at) {
  const p = beijingParts(at)
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`
}

/** 'yyyy-MM-dd HH:mm:ss'：支付宝协议要求的 timestamp 格式 */
function beijingTimestamp(at) {
  const p = beijingParts(at)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

/** 1~12：季节判定用（月份按东八区，不按容器月份） */
function beijingMonth(at) {
  return Number(beijingParts(at).month)
}

module.exports = { TZ, beijingParts, beijingDateStr, beijingStamp, beijingTimestamp, beijingMonth }
