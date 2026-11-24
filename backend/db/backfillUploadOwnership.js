/**
 * 老库上传所有权回填。
 *
 * 只认服务端上传流程产生的 URL/文件名：photos、clothing_items、deposits、
 * tryon_results。user_wardrobe / user_cosmetics / user_accessories / creator_works
 * 的 URL 字段可由用户填写，不能拿来证明文件归属，否则回填会重新制造签名预言机。
 */
const { isValidFilename } = require('../utils/uploads')

const UPLOAD_REFERENCE_RE = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:[?#].*)?$/

const TRUSTED_SOURCES = [
  {
    sql: `SELECT p.url AS reference, p.user_id
          FROM photos p JOIN users u ON u.id = p.user_id`,
    url: true,
  },
  {
    sql: `SELECT c.filename AS reference, u.id AS user_id
          FROM clothing_items c JOIN users u ON u.session_id = c.session_id`,
    url: false,
  },
  {
    sql: `SELECT d.proof_url AS reference, d.user_id
          FROM deposits d JOIN users u ON u.id = d.user_id`,
    url: true,
  },
  {
    sql: `SELECT t.result_url AS reference, t.user_id
          FROM tryon_results t JOIN users u ON u.id = t.user_id`,
    url: true,
  },
]

function filenameFromReference(reference, isUrl) {
  if (typeof reference !== 'string') return null
  const candidate = isUrl ? reference.match(UPLOAD_REFERENCE_RE)?.[1] : reference
  return isValidFilename(candidate) ? candidate : null
}

/** 幂等回填；已有所有权不覆盖，返回本次新增行数。 */
function backfillUploadOwnership(database) {
  const db = database || require('./init')
  const insert = db.prepare('INSERT OR IGNORE INTO upload_files (filename, user_id) VALUES (?, ?)')
  let inserted = 0
  const run = db.transaction(() => {
    for (const source of TRUSTED_SOURCES) {
      for (const row of db.prepare(source.sql).all()) {
        const filename = filenameFromReference(row.reference, source.url)
        if (!filename) continue
        inserted += insert.run(filename, row.user_id).changes
      }
    }
  })
  run()
  return inserted
}

module.exports = { backfillUploadOwnership }
