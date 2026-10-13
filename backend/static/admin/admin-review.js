/* ══════════════════════════════════════════════════════════════
   管理后台 — 收款凭证 & 创作者作品审核

   功能：凭证列表/确认/驳回、作品列表/审核/精选
   依赖: admin-utils.js（fetchJSON, apiCall, escapeHtml, showToast）
   ══════════════════════════════════════════════════════════════ */

var PAY_API = '/api/payment';
var CREATOR_API = '/api/creator';

var DEPOSIT_CN = { pending: '待确认', approved: '已确认', rejected: '已驳回' };
var DEPOSIT_BADGE = { pending: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };
var WORK_CN = { pending: '待审核', approved: '已上架', rejected: '未通过' };
var WORK_BADGE = { pending: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };
var TYPE_CN = { outfit: '搭配', makeup: '化妆', rule: '推荐规则', model: '模型' }; // model 已停,只用于显示历史数据

/* 后端错误体是 { success:false, error:{ code, message } } */
function apiErr(res) {
  return (res && res.error && res.error.message) || (res && res.message) || '请求失败';
}

function badge(map, clsMap, status) {
  return '<span class="badge ' + (clsMap[status] || 'badge-accent') + '">' +
    escapeHtml(map[status] || status) + '</span>';
}

function cardFallback(html) {
  return '<div class="card" style="text-align:center;color:var(--muted);">' + html + '</div>';
}

/* 作品"内容"转可读文本：新版是中文键，历史数据可能是英文键 JSON，那种原样贴出 */
function payloadText(p) {
  var d = p;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (e) { return d; }
  }
  if (!d || typeof d !== 'object') return '';
  if (Array.isArray(d['内容'])) return d['内容'].join('\n') + (d['备注'] ? '\n补充说明：' + d['备注'] : '');
  try { return JSON.stringify(d); } catch (e) { return ''; }
}

/* ── 收款凭证 ── */
document.getElementById('deposit-refresh').addEventListener('click', loadDeposits);
document.getElementById('deposit-filter').addEventListener('change', loadDeposits);

/* ── 收款金额 ── */
document.getElementById('price-save').addEventListener('click', savePrice);

function loadPrice() {
  fetchJSON(PAY_API + '/admin/price').then(function(res) {
    if (!res.success) throw new Error(apiErr(res));
    // 兜一层：接口形状哪天改了（比如错误也带 success:true）时，
    // p.amount.toFixed() 抛的 TypeError 会被下面当成"读取收款金额失败"，
    // 看着像接口坏了，其实是这个字段没来。缺字段就显示占位符。
    var p = res.data || {};
    var amt = Number(p.amount);
    var def = Number(p.default_amount);
    document.getElementById('price-now').textContent = '¥' + (isFinite(amt) ? amt.toFixed(2) : '—');
    document.getElementById('price-input').placeholder = isFinite(def) ? '新金额，如 ' + def : '新金额';
    document.getElementById('price-tip').textContent = p.source === 'db'
      ? '上次改动：' + (beijingOrRaw(p.updated_at) || '—')
      : '现在用的是代码默认值，后台还没改过';
  }).catch(function(e) {
    showToast('读取收款金额失败: ' + e.message, 'error');
  });
}

function savePrice() {
  var input = document.getElementById('price-input');
  var v = (input.value || '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) { showToast('金额最多两位小数，例如 99 或 59.9', 'error'); return; }
  if (!confirm('把收款金额改成 ¥' + v + '？只影响之后新建的订单。')) return;
  if (reviewBusy('price')) return;

  apiCall(PAY_API + '/admin/price', 'PUT', { amount: v }).then(function(res) {
    reviewFree('price');
    if (!res.success) throw new Error(apiErr(res));
    var saved = res.data && Number.isFinite(Number(res.data.amount)) ? Number(res.data.amount) : null;
    showToast('收款金额已改成 ¥' + (saved === null ? v : saved.toFixed(2)), 'success');
    input.value = '';
    loadPrice();
  }).catch(function(e) {
    reviewFree('price');
    showToast(e.message, 'error');
  });
}

// 凭证筛选下拉每改一次发一次请求，响应回来的先后顺序不保证 ⇒ 旧条件那条后到会顶掉新结果。
var _depositGate = seqGate();

function loadDeposits() {
  var tok = _depositGate.begin();
  var container = document.getElementById('deposit-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  var status = document.getElementById('deposit-filter').value;
  var url = PAY_API + '/admin/list' + (status ? '?status=' + encodeURIComponent(status) : '');

  fetchJSON(url).then(function(res) {
    if (!_depositGate.isCurrent(tok)) return;
    if (!res.success) throw new Error(apiErr(res));
    renderDeposits(res.data);
  }).catch(function(e) {
    if (!_depositGate.isCurrent(tok)) return;
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderDeposits(payload) {
  var container = document.getElementById('deposit-container');
  container.className = '';
  // 接口现在回 { list, total, limit }：list 是被 limit 截过的最近一段，total 才是全库条数。
  // 原来这里写 rows.length，凭证一旦超过 200 条，"共 200 条"就是假的（还有多少没显示看不出来）。
  var rows = (payload && payload.list) || [];
  var total = payload && typeof payload.total === 'number' ? payload.total : rows.length;
  var limit = payload && typeof payload.limit === 'number' ? payload.limit : 0;
  document.getElementById('deposit-count').textContent =
    '共 ' + total + ' 条' + (limit > 0 && rows.length < total ? '（下面只列最近 ' + rows.length + ' 条，接口上限 ' + limit + '）' : '');

  if (!rows.length) {
    container.innerHTML = cardFallback('暂无付款凭证');
    return;
  }

  container.innerHTML = rows.map(function(d) {
    // 只放行本站 uploads 下的相对路径，避免凭证里出现外链被后台页面直接打开
    var proof = typeof d.proof_url === 'string' && d.proof_url.indexOf('/uploads/') === 0
      ? '<a class="btn btn-sm" href="' + escapeHtml(d.proof_url) + '" target="_blank">🖼 看截图</a>'
      : '';
    return '<div class="inv-product-card">' +
      '<div class="inv-product-info">' +
        '<div class="inv-product-name">¥' + Number(d.amount).toFixed(2) + ' · ' +
          escapeHtml(d.channel === 'alipay' ? '支付宝' : '微信') + ' ' +
          badge(DEPOSIT_CN, DEPOSIT_BADGE, d.status) + '</div>' +
        '<div class="inv-product-meta">' +
          '<span style="color:var(--muted);font-size:12px;">#' + d.id +
            ' · 提交人: ' + escapeHtml(d.nickname || '匿名') + ' / ' + escapeHtml(d.phone || '-') +
            ' · ' + escapeHtml(beijingOrRaw(d.created_at)) + '</span>' +
        '</div>' +
        (d.admin_note ? '<div style="font-size:12px;color:var(--muted);">备注: ' + escapeHtml(d.admin_note) + '</div>' : '') +
      '</div>' +
      '<div class="inv-actions">' +
        proof +
        '<input type="text" id="dn-' + d.id + '" placeholder="审核备注" style="width:130px;">' +
        '<button class="btn btn-sm btn-green" onclick="setDepositStatus(' + d.id + ',\'approved\')">确认到账</button>' +
        '<button class="btn btn-sm btn-red" onclick="setDepositStatus(' + d.id + ',\'rejected\')">驳回</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* 在飞闸：这些动作按钮都是"点一次发一个请求"，连点两次＝发两个 POST。
   后端 payment.js / creator.js 的 UPDATE 都是 `WHERE id = ?`，第二次 changes=0
   会回"凭证不存在/作品不存在"的红 toast 盖住第一次的成功提示，
   管理员以为没存上又点一次——状态类接口必须一次只发一个。 */
var _reviewBusy = {};

function reviewBusy(key) {
  if (_reviewBusy[key]) return true;
  _reviewBusy[key] = true;
  return false;
}

function reviewFree(key) {
  delete _reviewBusy[key];
}

function setDepositStatus(id, status) {
  if (reviewBusy('dep-' + id + '-' + status)) return;
  var noteEl = document.getElementById('dn-' + id);
  apiCall(PAY_API + '/admin/' + id + '/status', 'POST', {
    status: status,
    admin_note: noteEl ? noteEl.value : ''
  }).then(function(res) {
    reviewFree('dep-' + id + '-' + status);
    if (!res.success) throw new Error(apiErr(res));
    showToast(status === 'approved' ? '已确认到账' : '已驳回', 'success');
    loadDeposits();
  }).catch(function(e) {
    reviewFree('dep-' + id + '-' + status);
    showToast(e.message, 'error');
  });
}

/* ── 创作者作品 ── */
document.getElementById('creator-refresh').addEventListener('click', loadCreatorWorks);
document.getElementById('creator-filter').addEventListener('change', loadCreatorWorks);

// 与凭证那格同一把尺：筛选下拉连改两次，旧条件那条响应后到会顶掉新结果。
var _creatorGate = seqGate();

function loadCreatorWorks() {
  var tok = _creatorGate.begin();
  var container = document.getElementById('creator-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  var status = document.getElementById('creator-filter').value;
  var url = CREATOR_API + '/admin/list' + (status ? '?status=' + encodeURIComponent(status) : '');

  fetchJSON(url).then(function(res) {
    if (!_creatorGate.isCurrent(tok)) return;
    if (!res.success) throw new Error(apiErr(res));
    renderCreatorWorks(res.data);
  }).catch(function(e) {
    if (!_creatorGate.isCurrent(tok)) return;
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderCreatorWorks(payload) {
  var container = document.getElementById('creator-container');
  container.className = '';
  // 接口回 { list, total, limit }，理由与 renderDeposits 那段注释同一条。
  var rows = (payload && payload.list) || [];
  var total = payload && typeof payload.total === 'number' ? payload.total : rows.length;
  var limit = payload && typeof payload.limit === 'number' ? payload.limit : 0;
  document.getElementById('creator-count').textContent =
    '共 ' + total + ' 件' + (limit > 0 && rows.length < total ? '（下面只列最近 ' + rows.length + ' 件，接口上限 ' + limit + '）' : '');

  if (!rows.length) {
    container.innerHTML = cardFallback('暂无创作者提交');
    return;
  }

  container.innerHTML = rows.map(function(w) {
    var link = location.origin + '/creator.html?work=' + w.id + '&ref=' + w.share_code;
    var text = payloadText(w.payload);
    var cover = typeof w.cover_url === 'string' && w.cover_url.indexOf('/uploads/') === 0
      ? '<a class="btn btn-sm" href="' + escapeHtml(w.cover_url) + '" target="_blank">🖼 看封面</a>'
      : '';
    return '<div class="inv-product-card">' +
      '<div class="inv-product-info">' +
        '<div class="inv-product-name">' + escapeHtml(w.title) + ' ' +
          '<span class="badge badge-accent">' + escapeHtml(TYPE_CN[w.type] || w.type) + '</span> ' +
          badge(WORK_CN, WORK_BADGE, w.status) +
          (w.featured ? ' <span class="badge badge-purple">精选</span>' : '') + '</div>' +
        '<div class="inv-product-meta">' +
          '<span style="color:var(--muted);font-size:12px;">#' + w.id +
            ' · 作者: ' + escapeHtml(w.nickname || '匿名') + ' / ' + escapeHtml(w.phone || '-') +
            ' · 浏览 ' + (w.heat || 0) + ' · 分享带量 ' + (w.share_views || 0) +
            ' · ' + escapeHtml(beijingOrRaw(w.created_at)) + '</span>' +
        '</div>' +
        (w.summary ? '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">' + escapeHtml(w.summary) + '</div>' : '') +
        (text ? '<div style="font-size:13px;white-space:pre-wrap;margin-bottom:6px;">' + escapeHtml(text) + '</div>' : '') +
        '<div style="font-size:11px;font-family:SF Mono,Consolas,monospace;color:var(--accent);word-break:break-all;">' +
          escapeHtml(link) + '</div>' +
        (w.admin_note ? '<div style="font-size:12px;color:var(--muted);">上次备注: ' + escapeHtml(w.admin_note) + '</div>' : '') +
      '</div>' +
      '<div class="inv-actions">' +
        cover +
        '<input type="text" id="cn-' + w.id + '" placeholder="审核备注" style="width:130px;">' +
        '<button class="btn btn-sm btn-green" onclick="reviewWork(' + w.id + ',\'approved\')">通过上广场</button>' +
        '<button class="btn btn-sm btn-red" onclick="reviewWork(' + w.id + ',\'rejected\')">驳回</button>' +
        '<button class="btn btn-sm" onclick="featureWork(' + w.id + ',' + (w.featured ? 0 : 1) + ')">' +
          (w.featured ? '取消精选' : '设为精选') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function reviewWork(id, status) {
  if (reviewBusy('work-' + id + '-' + status)) return;
  var noteEl = document.getElementById('cn-' + id);
  apiCall(CREATOR_API + '/admin/' + id + '/review', 'POST', {
    status: status,
    admin_note: noteEl ? noteEl.value : ''
  }).then(function(res) {
    reviewFree('work-' + id + '-' + status);
    if (!res.success) throw new Error(apiErr(res));
    showToast(status === 'approved' ? '已上广场' : '已驳回', 'success');
    loadCreatorWorks();
  }).catch(function(e) {
    reviewFree('work-' + id + '-' + status);
    showToast(e.message, 'error');
  });
}

function featureWork(id, featured) {
  if (reviewBusy('feat-' + id)) return;
  apiCall(CREATOR_API + '/admin/' + id + '/feature', 'POST', { featured: featured }).then(function(res) {
    reviewFree('feat-' + id);
    if (!res.success) throw new Error(apiErr(res));
    showToast(res.message || '已保存', 'success');
    loadCreatorWorks();
  }).catch(function(e) {
    reviewFree('feat-' + id);
    showToast(e.message, 'error');
  });
}

/* ── 会员账号（找回密码 = 管理员代重置） ── */
var AUTH_API = '/api/auth';
var MemberRows = [];
var MemberTotal = 0;
var MemberLimit = 0;

document.getElementById('member-refresh').addEventListener('click', loadAccounts);
document.getElementById('member-search').addEventListener('input', renderAccounts);

function loadAccounts() {
  var container = document.getElementById('member-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  fetchJSON(AUTH_API + '/admin/accounts').then(function(res) {
    if (!res.success) throw new Error(apiErr(res));
    MemberRows = (res.data && res.data.accounts) || [];
    // total 是真 COUNT(*)，accounts 只到 limit 条：注册超过 500 人之后的新人不在这一页里，
    // 而"共 N 个账号"必须报真数，否则后台会以为没人注册。搜索框搜的仍然只是已载入这段。
    MemberTotal = res.data && typeof res.data.total === 'number' ? res.data.total : MemberRows.length;
    MemberLimit = res.data && typeof res.data.limit === 'number' ? res.data.limit : 0;
    renderAccounts();
  }).catch(function(e) {
    MemberRows = [];
    MemberTotal = 0;
    MemberLimit = 0;
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderAccounts() {
  var container = document.getElementById('member-container');
  container.className = '';

  var kw = (document.getElementById('member-search').value || '').trim();
  var rows = kw
    ? MemberRows.filter(function(a) {
        return String(a.phone).indexOf(kw) >= 0 || String(a.nickname || '').indexOf(kw) >= 0;
      })
    : MemberRows;

  document.getElementById('member-count').textContent =
    '共 ' + MemberTotal + ' 个账号' +
    (MemberLimit > 0 && MemberRows.length < MemberTotal ? '（已载入最近 ' + MemberRows.length + ' 个，接口上限 ' + MemberLimit + '）' : '') +
    (kw ? '，筛出 ' + rows.length + ' 个' : '');

  if (!rows.length) {
    container.innerHTML = cardFallback(MemberRows.length ? '没有匹配的账号' : '还没有人注册过账号');
    return;
  }

  container.innerHTML = rows.map(function(a) {
    return '<div class="inv-product-card">' +
      '<div class="inv-product-info">' +
        '<div class="inv-product-name">' + escapeHtml(a.nickname || '未填昵称') + '</div>' +
        '<div class="inv-product-meta">' +
          '<span style="color:var(--muted);font-size:12px;">' + escapeHtml(a.phone) +
            ' · 身份 #' + a.user_id + ' · 注册于 ' + escapeHtml(beijingOrRaw(a.created_at)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="inv-actions">' +
        '<input type="text" id="pw-' + a.user_id + '" placeholder="新密码 6-64 位" style="width:150px;">' +
        '<button class="btn btn-sm btn-primary" onclick="resetMemberPassword(' + a.user_id + ')">重置密码</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function resetMemberPassword(userId) {
  var acc = MemberRows.find(function(a) { return a.user_id === userId; });
  if (!acc) { showToast('账号已不在列表里，请刷新', 'error'); return; }

  var input = document.getElementById('pw-' + userId);
  var pw = input ? input.value : '';
  if (pw.length < 6 || pw.length > 64) { showToast('新密码长度需在 6-64 位之间', 'error'); return; }
  if (!confirm('把 ' + acc.phone + ' 的密码改成刚填的这个？会员数据不受影响。')) return;
  // 连点两次会发两次 bcrypt 代换：第二次也回成功（后端按手机号更新，不判 changes），
  // 白跑一次哈希，还可能把两次不同输入都写进去
  if (reviewBusy('pw-' + userId)) return;

  apiCall(AUTH_API + '/admin/reset-password', 'POST', { phone: acc.phone, new_password: pw })
    .then(function(res) {
      reviewFree('pw-' + userId);
      if (!res.success) throw new Error(apiErr(res));
      showToast(res.message || '密码已重置', 'success');
      if (input) input.value = '';
    })
    .catch(function(e) { reviewFree('pw-' + userId); showToast(e.message, 'error'); });
}
