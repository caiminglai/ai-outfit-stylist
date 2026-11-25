'use strict'

// 报告形状只说明“这一行是报告”，不等于钱已到账；领取幂等与报告识别仍按形状判断。
const REPORT_SHAPE_SQL =
  "(result IS NOT NULL AND json_valid(result) AND json_extract(result, '$.paid_report.out_trade_no') IS NOT NULL)"

// 删除时永久保留的已付费报告：报告必须属于本人，且平台订单已 paid 或人工凭证已 approved。
// 只认 JSON 形状会把 created/closed/不存在的订单也当成交付物，导致未到账数据永久留在库里。
const PAID_REPORT_SQL =
  `(${REPORT_SHAPE_SQL} AND (` +
  'EXISTS (SELECT 1 FROM payment_orders WHERE payment_orders.out_trade_no = ' +
  "json_extract(recommendation_logs.result, '$.paid_report.out_trade_no') " +
  "AND payment_orders.user_id = recommendation_logs.user_id AND payment_orders.status = 'paid') " +
  "OR EXISTS (SELECT 1 FROM deposits WHERE 'DEPOSIT-' || deposits.id = " +
  "json_extract(recommendation_logs.result, '$.paid_report.out_trade_no') " +
  "AND deposits.user_id = recommendation_logs.user_id AND deposits.status = 'approved')" +
  '))'

/**
 * 找出本次删除范围内必须保留的已付费报告及其生成依据。
 * where/params 由调用方给出已经完成归属过滤的条件，两个删除入口共用同一判据。
 */
function collectPaidReportRetention(db, where, params) {
  const paidReports = db
    .prepare(
      `SELECT id, result FROM recommendation_logs
       WHERE (${where}) AND ${PAID_REPORT_SQL}`,
    )
    .all(...params)
  const retainedLogIds = new Set(paidReports.map((row) => Number(row.id)))
  for (const row of paidReports) {
    try {
      const basisId = Number(JSON.parse(row.result)?.paid_report?.basis_log_id)
      if (Number.isInteger(basisId) && basisId > 0) retainedLogIds.add(basisId)
    } catch {
      // 损坏的报告仍按报告本身保留，不能因为取不出依据 id 就把交付物删掉。
    }
  }
  const retainedList = [...retainedLogIds]
  return {
    paidReports,
    retainedList,
    paidReportsRetained: paidReports.length,
    reportBasisRetained: retainedList.length - paidReports.length,
  }
}

module.exports = { REPORT_SHAPE_SQL, PAID_REPORT_SQL, collectPaidReportRetention }
