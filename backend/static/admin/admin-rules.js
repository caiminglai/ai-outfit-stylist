/* ══════════════════════════════════════════════════════════════
   管理后台 — 规则编辑器模块

   功能：规则列表/筛选/新建/编辑/启用停用/删除/试算
   依赖: admin-utils.js（State, fetchJSON, apiCall, escapeHtml, showToast,
         CATEGORY_LABELS, RULES_API）
   ══════════════════════════════════════════════════════════════ */

/* ── 筛选事件绑定 ── */
['filter-mode', 'filter-gender', 'filter-category', 'filter-scenario', 'filter-tag', 'filter-part', 'filter-evidence', 'filter-enabled', 'filter-hit'].forEach(function(id) {
  document.getElementById(id).addEventListener('change', loadRules);
});
document.getElementById('rules-refresh').addEventListener('click', loadRules);
document.getElementById('rules-create-btn').addEventListener('click', function() { openRuleModal(null); });
document.getElementById('rules-preview-btn').addEventListener('click', openPreviewModal);

/* ── 编辑器元数据:字段/动作/类别/场景都由后端给出,前端不写死 ── */
var RULE_SCHEMA = null;
/* 这几张表的键来自后端下发的库里真实取值：必须用无原型对象。
   否则某条规则的 field/action_type/tag 写成 constructor 时，MAP['constructor'] 会顺着
   原型链拿到 Object 构造器（truthy ⇒ `|| 原值` 挡不住），后台那一格显示成函数源码。 */
var FIELD_LABEL_MAP = Object.create(null);
var ACTION_LABEL_MAP = Object.create(null);
var TAG_LABEL_MAP = Object.create(null);
var PART_LABEL_MAP = Object.create(null);
/** 依据档位:标签/说明/下拉项都由 /api/rules/schema 下发,与 services/evidenceLevels.js 同源 */
var EVIDENCE_LABEL_MAP = Object.create(null);
var EVIDENCE_NOTE_MAP = Object.create(null);
var EVIDENCE_OPTIONS = [];
/** 徽章配色:A 硬指标绿、B 实证蓝、C 体系橙、D 命理灰紫、未标注灰 */
var EVIDENCE_BADGE_CLASS = { A: 'badge-green', B: 'badge-accent', C: 'badge-orange', D: 'badge-purple' };
/** 试算渲染时要跳过的非动作字段(引擎附带的分组元信息与派生分) */
var PREVIEW_META_KEYS = {
  group_id: 1, group_name: 1, priority: 1, score: 1, explanation: 1,
  evidence_level: 1, color_fit: 1, body_fit: 1, feedback: 1, condition_details: 1,
  // 10-19 第二阶段：综合排序分（对象）＋这条候选来自衣柜哪一行（内部 id / 来源标记）
  rank: 1, source: 1, wardrobe_item_id: 1,
  // 10-20 第六阶段·第一步：色彩接线的三笔账目字段（basis=怎么认出色来的、parts=参与呼应的件数、
  // color_text=衣橱那条取色用的原串）。都要印在"上衣贴合度"那一行里，不单独打英文键。
  color_basis: 1, color_parts: 1, color_text: 1,
  // 10-21 第十三阶段·一 §二·3 借色＋§二·4 关系色的五笔出处（同上，只在贴合度那一行说，不单独打英文键）
  color_basis_source: 1, color_borrowed: 1, color_borrowed_from: 1,
  color_borrowed_position: 1, color_relational_from: 1, color_relational: 1, color_top_band: 1,
  // 10-21 第十三阶段·一 §三·4：版型档推断的两件出处（同上，只在身材适配度那一行说）
  fit_type_inferred: 1, fabric_weight_inferred: 1,
};

/**
 * 元数据加载状态机（2026-10-11 修：原来只有 RULE_SCHEMA 一格）
 *
 * 原写法：加载失败后 RULE_SCHEMA 仍是 null，而三个入口（loadRules、openRuleModal、
 * openPreviewModal）都写着 `if (!RULE_SCHEMA) { ensureSchema(重试自己); return; }`
 * ⇒ 失败一次就再发一次请求、再失败再发，人手点一下刷新又是一轮，永不自断。
 * 现在的四条硬约束：
 *   1) 同一时刻只允许一个在飞的 schema 请求，其余入口挂进 SCHEMA_WAITERS 等同一个结果；
 *   2) 一次会话内最多打 SCHEMA_MAX_ATTEMPTS 次（1 次首发 + 1 次自动重试，只治网络抖动），
 *      次数用尽后不再自动发，等用户手动点「重试」；
 *   3) 所有 done 都先进队列再统一 flush，绝不各调各的 ⇒ 每个 done 恰好被调用一次，
 *      参数 ok=true/false，调用方据此渲染数据或"点重试"占位；
 *   4) SCHEMA_ATTEMPTS 只在成功或手动重试时清零，避免"失败后每次筛选都偷偷补一发"。
 */
var SCHEMA_INFLIGHT = false;
var SCHEMA_ATTEMPTS = 0;
var SCHEMA_MAX_ATTEMPTS = 2;
var SCHEMA_RETRY_TIMER = null;
/** 等待同一个 schema 结果的回调队列 */
var SCHEMA_WAITERS = [];

function flushSchemaWaiters(ok) {
  var waiters = SCHEMA_WAITERS;
  SCHEMA_WAITERS = [];
  waiters.forEach(function (fn) {
    try { fn(ok); } catch (err) { console.error('[规则元数据回调]', err); }
  });
}

function runSchemaFetch() {
  SCHEMA_INFLIGHT = true;
  SCHEMA_ATTEMPTS++;
  fetchJSON(RULES_API + '/schema').then(function(res) {
    if (!res.success) throw new Error(res.message || '接口没返回 success');
    RULE_SCHEMA = res.data;
    RULE_SCHEMA.fields.forEach(function(p) { FIELD_LABEL_MAP[p.value] = p.label; });
    RULE_SCHEMA.actionTypes.forEach(function(p) { ACTION_LABEL_MAP[p.value] = p.label; });
    // 数据浏览器也翻译这两列：以后端标签为准合并，新增条件字段不用再改前端
    VALUE_LABELS['rule_conditions.field'] = Object.assign({}, VALUE_LABELS['rule_conditions.field'], FIELD_LABEL_MAP);
    VALUE_LABELS['rule_actions.action_type'] = Object.assign({}, VALUE_LABELS['rule_actions.action_type'], ACTION_LABEL_MAP);
    fillOptions('filter-category', RULE_SCHEMA.categories, '全部类别');
    fillOptions('filter-scenario', RULE_SCHEMA.scenarios, '全部场景');
    fillOptions('filter-tag', RULE_SCHEMA.tags, '全部体系');
    fillOptions('filter-part', RULE_SCHEMA.parts, '全部部位/结论');
    EVIDENCE_OPTIONS = RULE_SCHEMA.evidenceLevels || [];
    EVIDENCE_OPTIONS.forEach(function (p) {
      EVIDENCE_LABEL_MAP[p.value] = p.label;
      EVIDENCE_NOTE_MAP[p.value] = p.note || '';
    });
    fillOptions('filter-evidence', EVIDENCE_OPTIONS, '全部依据档位');
    SCHEMA_INFLIGHT = false;
    SCHEMA_ATTEMPTS = 0;
    flushSchemaWaiters(true);
  }).catch(function(e) {
    SCHEMA_INFLIGHT = false;
    if (SCHEMA_ATTEMPTS < SCHEMA_MAX_ATTEMPTS) {
      // 队列原样留着：自动重试成功后，最初那个调用方照常拿到 ok=true 往下走
      if (SCHEMA_RETRY_TIMER) clearTimeout(SCHEMA_RETRY_TIMER);
      SCHEMA_RETRY_TIMER = setTimeout(function () {
        SCHEMA_RETRY_TIMER = null;
        runSchemaFetch();
      }, 600);
      return;
    }
    showToast('规则元数据加载失败: ' + e.message, 'error');
    flushSchemaWaiters(false);
  });
}

function ensureSchema(done) {
  if (RULE_SCHEMA) { done(true); return; }
  SCHEMA_WAITERS.push(done);
  if (SCHEMA_INFLIGHT) return;
  // 次数用尽：直接把拿不到这件事告诉调用方，由它显示手动重试入口
  if (SCHEMA_ATTEMPTS >= SCHEMA_MAX_ATTEMPTS) { flushSchemaWaiters(false); return; }
  runSchemaFetch();
}

/** 元数据彻底拉不到时的列表占位：给一个手动重试入口，不自动再打 */
function schemaErrorBox(container, retryFn) {
  container.className = 'empty-state';
  container.textContent = '';
  var p = document.createElement('div');
  p.textContent = '规则元数据（/api/rules/schema）连续 ' + SCHEMA_MAX_ATTEMPTS + ' 次加载失败，列表无法渲染。';
  var btn = document.createElement('button');
  btn.className = 'btn btn-sm';
  btn.textContent = '重试';
  btn.addEventListener('click', function () {
    SCHEMA_ATTEMPTS = 0;
    if (SCHEMA_RETRY_TIMER) { clearTimeout(SCHEMA_RETRY_TIMER); SCHEMA_RETRY_TIMER = null; }
    retryFn();
  });
  container.appendChild(p);
  container.appendChild(btn);
}


/**
 * 用后端给的下拉数据填充 select
 * values 既支持纯字符串数组(类别/场景),也支持 {value,label,count} 数组(体系/部位)
 */
function fillOptions(id, values, allLabel) {
  var sel = document.getElementById(id);
  if (!sel || !values) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">' + escapeHtml(allLabel) + '</option>' + values.map(function(v) {
    var item = typeof v === 'string' ? { value: v, label: v } : v;
    if (id === 'filter-tag') TAG_LABEL_MAP[item.value] = item.label;
    if (id === 'filter-part') PART_LABEL_MAP[item.value] = item.label;
    var text = (item.label || item.value) + (item.count ? ' ' + item.count : '');
    return '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(text) + '</option>';
  }).join('');
  sel.value = current;
}

/* ── 加载规则列表 ── */
// 8 个筛选下拉每个 change 都发一次请求，快速连改（或改完又点刷新）就会有多条响应同时在
// 路上；fetchJSON 不保证按发送顺序返回 ⇒ 带着旧筛选条件的那条后到，会把新结果整页覆盖掉，
// 列表显示的和服务器按新条件算出来的不是同一批规则。走公共 seqGate（admin-utils.js）：
// 号不是最新的那条响应整条丢掉，连"加载失败"也不覆盖，免得旧请求的报错顶掉新页面。
var _rulesGate = seqGate();
function loadRules() {
  var tok = _rulesGate.begin();
  // ok=false ⇒ 元数据已按上限重试过仍拿不到，显示手动重试入口，绝不再自动发请求
  if (!RULE_SCHEMA) {
    ensureSchema(function(ok) {
      if (ok) { loadRules(); return; }
      schemaErrorBox(document.getElementById('rules-container'), loadRules);
    });
    return;
  }
  var container = document.getElementById('rules-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  var params = [];
  var mode = document.getElementById('filter-mode').value;
  var gender = document.getElementById('filter-gender').value;
  var category = document.getElementById('filter-category').value;
  var scenario = document.getElementById('filter-scenario').value;
  var enabled = document.getElementById('filter-enabled').value;
  var hit = document.getElementById('filter-hit').value;
  var tag = document.getElementById('filter-tag').value;
  var part = document.getElementById('filter-part').value;
  var evidence = document.getElementById('filter-evidence').value;

  if (mode) params.push('mode=' + mode);
  if (gender) params.push('gender=' + encodeURIComponent(gender));
  if (category) params.push('category=' + encodeURIComponent(category));
  if (scenario) params.push('scenario=' + encodeURIComponent(scenario));
  if (tag) params.push('tag=' + encodeURIComponent(tag));
  if (part) params.push('part=' + encodeURIComponent(part));
  if (evidence) params.push('evidence=' + encodeURIComponent(evidence));
  if (enabled) params.push('enabled=' + enabled);
  if (hit) params.push('hit=' + encodeURIComponent(hit));

  var url = RULES_API + '/groups' + (params.length ? '?' + params.join('&') : '');

  fetchJSON(url).then(function(res) {
    if (!_rulesGate.isCurrent(tok)) return;
    if (!res.success) throw new Error(res.message);
    State.rules = res.data.groups;
    renderRules(res.data.groups);
    document.getElementById('rules-count').textContent = '共 ' + (res.data.total !== undefined ? res.data.total : res.data.groups.length) + ' 条规则';
  }).catch(function(e) {
    if (!_rulesGate.isCurrent(tok)) return;
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ── 依据档位徽章：库里存 A/B/C/D，NULL 显示"未标注" ── */
function evidenceBadge(level) {
  var v = level || 'none';
  // label 由后端 /api/rules/schema 下发（"A 国标/国际标准"这类），原来算完就没用，
  // 徽章只回显一个字母 ⇒ 后台看着"A"得自己回忆那是哪一档。现在把 label 直接当文案。
  var label = EVIDENCE_LABEL_MAP[v] || (level ? level + ' 档' : '未标注');
  var note = EVIDENCE_NOTE_MAP[v] || '未标注：后台手工建或前缀认不出来';
  var cls = EVIDENCE_BADGE_CLASS[v] || '';
  var style = cls ? '' : ' style="background:var(--bg);color:var(--muted);border:1px dashed var(--border);"';
  return '<span class="badge ' + cls + '"' + style + ' title="' + escapeHtml(note) + '">依据 ' + escapeHtml(label) + '</span>';
}

/* ── 渲染规则卡片 ── */
function renderRules(groups) {
  var container = document.getElementById('rules-container');
  container.className = '';

  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--muted);">暂无规则数据，点击「新建规则」创建第一条规则</div>';
    return;
  }

  container.innerHTML = '';
  groups.forEach(function(g) {
    var card = document.createElement('div');
    card.className = 'rule-card' + (g.enabled ? '' : ' disabled');

    var condSummary = (g.conditions || []).map(function(c) {
      return escapeHtml(FIELD_LABEL_MAP[c.field] || c.field) + '=' + escapeHtml(condValueOf(c));
    }).join('，');

    var actionSummary = (g.actions || []).map(function(a) {
      return escapeHtml(ACTION_LABEL_MAP[a.action_type] || a.action_type);
    }).join(' / ');

    var header = document.createElement('div');
    header.className = 'rule-header';
    header.innerHTML =
      '<span class="rule-name">' + escapeHtml(g.name) + '</span>' +
      '<span class="rule-meta">' +
        '<span class="badge badge-accent">' + escapeHtml(ownLabel(CATEGORY_LABELS, g.category) || g.category) + '</span>' +
        (g.tag ? '<span class="badge badge-purple" title="' + escapeHtml(g.source_key || '') + '">' + escapeHtml(TAG_LABEL_MAP[g.tag] || g.tag) + '</span>' : '') +
        evidenceBadge(g.evidence_level) +
        (g.gender ? '<span class="badge badge-purple">' + escapeHtml(g.gender) + '</span>' : '') +
        (g.scenario ? '<span class="badge badge-green">' + escapeHtml(g.scenario) + '</span>' : '') +
        '<span class="badge ' + (g.enabled ? 'badge-green' : 'badge-red') + '">' + (g.enabled ? '启用' : '停用') + '</span>' +
        (g.priority ? '<span class="badge badge-orange">P' + g.priority + '</span>' : '') +
        '<span class="badge" style="background:var(--bg);color:var(--muted);" title="命中次数/最近命中时间">🎯 命中 ' + (g.hit_count || 0) + (g.last_hit_at ? ' · 最近 ' + escapeHtml(beijingOrRaw(g.last_hit_at).slice(0, 16)) : ' · 从未命中') + '</span>' +
      '</span>';

    var body = document.createElement('div');
    body.className = 'rule-body';
    body.innerHTML =
      '<div class="rule-section-label">规则说明</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">' + escapeHtml(g.description || '无') + '</div>' +
      '<div class="rule-section-label">匹配条件 (' + (g.conditions || []).length + ')</div>' +
      '<div style="font-size:12px;margin-bottom:10px;font-family:SF Mono,Consolas,monospace;color:var(--accent);">' + (condSummary || '无') + '</div>' +
      '<div class="rule-section-label">输出动作 (' + (g.actions || []).length + ')</div>' +
      '<div style="font-size:12px;margin-bottom:14px;font-family:SF Mono,Consolas,monospace;color:var(--green);">' + (actionSummary || '无') + '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-sm" onclick="openRuleModal(' + g.id + ')">✏️ 编辑</button>' +
        '<button class="btn btn-sm ' + (g.enabled ? 'btn-red' : 'btn-green') + '" onclick="toggleRule(' + g.id + ')">' + (g.enabled ? '停用' : '启用') + '</button>' +
        '<button class="btn btn-sm btn-red" onclick="deleteRule(' + g.id + ')">🗑 删除</button>' +
      '</div>';

    header.addEventListener('click', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      body.classList.toggle('open');
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  });
}

/* ── 规则编辑模态框 ── */
function openRuleModal(ruleId) {
  if (!RULE_SCHEMA) {
    ensureSchema(function(ok) {
      if (ok) { openRuleModal(ruleId); return; }
      showToast('规则元数据没拿到，编辑器打不开，请先在规则列表点「重试」', 'error');
    });
    return;
  }
  State.editingRuleId = ruleId;
  var title = document.getElementById('rule-modal-title');
  var body = document.getElementById('rule-modal-body');

  if (ruleId) {
    title.textContent = '编辑规则 #' + ruleId;
    var rule = State.rules.find(function(r) { return r.id === ruleId; });
    if (!rule) return;
    body.innerHTML = buildRuleForm(rule);
  } else {
    title.textContent = '新建规则';
    body.innerHTML = buildRuleForm(null);
  }
  document.getElementById('rule-modal').classList.add('open');
}

function closeRuleModal() {
  document.getElementById('rule-modal').classList.remove('open');
  State.editingRuleId = null;
}

/* ── 启用状态的勾选判定 ──
   库里 rule_groups.enabled 是 INTEGER(0/1)，better-sqlite3 交回来的是数字。
   写成 `g.enabled !== false` 时 0 !== false 成立 ⇒ 停用规则打开编辑框是勾上的，
   管理员只改描述保存，前端送 enabled:true，后端 PUT 认 true ⇒ 写回 1，
   这条停用规则在门店/个人两种模式下悄悄重新开始命中。
   判定口径与后端 routes/rules.js 的 PUT 完全一致（false/0/'0'/'false' 都算停用）。 */
function isEnabledOn(v) {
  return !(v === false || v === 0 || v === '0' || v === 'false');
}

/* ── 构建规则表单 HTML ── */
function buildRuleForm(rule) {
  var g = rule || {};
  var conditions = g.conditions || [
    { field: 'skin_tone', operator: 'eq', value: 'all', weight: 1 },
    { field: 'face_shape', operator: 'eq', value: 'all', weight: 1 }
  ];
  var actions = g.actions || [
    { action_type: 'top_style', content: '', sort_order: 0 },
    { action_type: 'reason', content: '', sort_order: 1 }
  ];

  var html = '';
  html += '<div class="form-row">';
  html += '<div class="form-group"><label>规则名称 <span class="req">*</span></label><input type="text" id="rf-name" value="' + escapeHtml(g.name || '') + '" placeholder="如：女-通勤-穿搭-暖皮"></div>';
  html += '<div class="form-group"><label>优先级</label><input type="number" id="rf-priority" value="' + (g.priority || 0) + '" placeholder="数字越大越优先"></div>';
  html += '</div>';

  html += '<div class="form-row">';
  // 三个选项都要给：库里 97 条种子规则的 mode 是 'all'(门店+个人通用)。
  // 少了这一项，编辑这类规则时下拉会默默显示"门店模式"，一保存就把 all 降级成 store，
  // 这条规则随即在个人模式下不再命中——改依据档位时最容易踩的坑。
  html += '<div class="form-group"><label>推荐模式</label><select id="rf-mode"><option value="store"' + (g.mode === 'store' ? ' selected' : '') + '>门店模式</option><option value="personal"' + (g.mode === 'personal' ? ' selected' : '') + '>个人衣橱</option><option value="all"' + (g.mode === 'all' ? ' selected' : '') + '>门店+个人通用</option></select></div>';
  html += '<div class="form-group"><label>性别</label><select id="rf-gender"><option value="">不限</option><option value="女"' + (g.gender === '女' ? ' selected' : '') + '>女</option><option value="男"' + (g.gender === '男' ? ' selected' : '') + '>男</option></select></div>';
  html += '<div class="form-group"><label>推荐类别 <span class="req">*</span></label><select id="rf-category">' + optionsHtml(RULE_SCHEMA.categories, g.category, '请选择') + '</select></div>';
  html += '<div class="form-group"><label>场景</label><select id="rf-scenario">' + optionsHtml(RULE_SCHEMA.scenarios, g.scenario, '不限') + '</select></div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group"><label>依据档位</label><select id="rf-evidence">' + evidenceOptionsHtml(g.evidence_level) + '</select>' +
    '<div style="font-size:11px;color:var(--muted);margin-top:4px;">只有 A/B 两档能对顾客说"科学依据";C 是行业体系、D 是命理,措辞要分开。留空=未标注,按 C 对待。</div></div>';
  html += '</div>';

  html += '<div class="form-group"><label>规则说明</label><textarea id="rf-description" placeholder="描述该规则的适用场景和推荐逻辑">' + escapeHtml(g.description || '') + '</textarea></div>';

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px;">';
  html += '<div class="rule-section-label" style="margin:0;">匹配条件</div>';
  html += '<button class="add-row-btn" onclick="addConditionRow()">+ 添加条件</button>';
  html += '</div>';
  html += '<div id="conditions-container">';
  conditions.forEach(function(c, i) { html += buildConditionRow(c, i); });
  html += '</div>';

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px;">';
  html += '<div class="rule-section-label" style="margin:0;">输出动作</div>';
  html += '<button class="add-row-btn" onclick="addActionRow()">+ 添加动作</button>';
  html += '</div>';
  html += '<div id="actions-container">';
  actions.forEach(function(a, i) { html += buildActionRow(a, i); });
  html += '</div>';

  html += '<div class="form-group" style="margin-top:14px;"><label><input type="checkbox" id="rf-enabled"' + (isEnabledOn(g.enabled) ? ' checked' : '') + '> 启用此规则</label></div>';
  return html;
}

/* ── 下拉项生成:库里已有的值一定保留,否则编辑保存时会把它改成列表第一项 ── */
function optionsHtml(values, current, allLabel) {
  var list = (values || []).slice();
  if (current && list.indexOf(current) < 0) list = [current].concat(list);
  var html = allLabel ? '<option value="">' + escapeHtml(allLabel) + '</option>' : '';
  return html + list.map(function(v) {
    return '<option value="' + escapeHtml(v) + '"' + (v === current ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
  }).join('');
}

function pairOptionsHtml(pairs, current) {
  var list = (pairs || []).slice();
  if (current && !list.some(function(p) { return p.value === current; })) {
    list.unshift({ value: current, label: current + '（未收录）' });
  }
  return list.map(function(p) {
    return '<option value="' + escapeHtml(p.value) + '"' + (p.value === current ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>';
  }).join('');
}

/** 依据档位下拉:选项来自 /schema,'none'(未标注)在表单里用空值表示 */
function evidenceOptionsHtml(current) {
  var html = '<option value="">未标注</option>';
  (EVIDENCE_OPTIONS || []).forEach(function(p) {
    if (p.value === 'none') return;
    html += '<option value="' + escapeHtml(p.value) + '"' + (current === p.value ? ' selected' : '') + '>' +
      escapeHtml(p.label) + (p.count ? ' (' + p.count + ')' : '') + '</option>';
  });
  if (current && !['A', 'B', 'C', 'D'].includes(current)) {
    html = '<option value="' + escapeHtml(current) + '" selected>' + escapeHtml(current + '（未收录）') + '</option>' + html;
  }
  return html;
}

/* 条件值在库里是 JSON 字符串({"skin_tone":"暖皮"}),编辑框和列表都要还原成人填的那个值 */
function condValueOf(c) {
  var v = c.value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { return v; }
  }
  if (v && typeof v === 'object') v = (c.field in v) ? v[c.field] : Object.values(v)[0];
  if (Array.isArray(v)) v = v.join(',');
  return v === null || v === undefined ? '' : String(v);
}

function buildConditionRow(c, idx) {
  return '<div class="condition-row" data-idx="' + idx + '">' +
    '<select class="cond-field">' + pairOptionsHtml(RULE_SCHEMA.fields, c.field) + '</select>' +
    '<select class="cond-op">' + pairOptionsHtml(RULE_SCHEMA.operators, c.operator) + '</select>' +
    '<input type="text" class="cond-value" value="' + escapeHtml(condValueOf(c)) + '" placeholder="值（all=不限，属于用逗号分隔）">' +
    '<input type="number" class="cond-weight" value="' + (c.weight || 1) + '" style="flex:0 0 60px;" title="权重">' +
    '<button class="remove-row-btn" onclick="this.parentElement.remove()">×</button>' +
    '</div>';
}

function buildActionRow(a, idx) {
  // 把库里的 sort_order 带在行上：保存时原样回传，新增行才排到末尾（见保存动作那段注释）
  var kept = a && a.sort_order !== null && a.sort_order !== undefined ? a.sort_order : '';
  return '<div class="action-row" data-idx="' + idx + '" data-sort="' + kept + '">' +
    '<select class="action-type">' + pairOptionsHtml(RULE_SCHEMA.actionTypes, a.action_type) + '</select>' +
    '<input type="text" class="action-content" value="' + escapeHtml(String(a.content || '')) + '" placeholder="输出内容">' +
    '<button class="remove-row-btn" onclick="this.parentElement.remove()">×</button>' +
    '</div>';
}

function addConditionRow() {
  var container = document.getElementById('conditions-container');
  var div = document.createElement('div');
  div.innerHTML = buildConditionRow({ field: 'skin_tone', operator: 'eq', value: 'all', weight: 1 }, container.children.length);
  container.appendChild(div.firstChild);
}

function addActionRow() {
  var container = document.getElementById('actions-container');
  var div = document.createElement('div');
  // 不给 sort_order：新行在保存时排到已有最大值之后（给了行号会和库里的间隔值打架）
  div.innerHTML = buildActionRow({ action_type: 'reason', content: '' }, container.children.length);
  container.appendChild(div.firstChild);
}

/* ── 保存规则 ── */
document.getElementById('rule-save-btn').addEventListener('click', function() {
  var name = document.getElementById('rf-name').value.trim();
  var category = document.getElementById('rf-category').value;
  if (!name) { showToast('规则名称不能为空', 'error'); return; }
  if (!category) { showToast('推荐类别不能为空', 'error'); return; }

  var data = {
    name: name,
    mode: document.getElementById('rf-mode').value,
    gender: document.getElementById('rf-gender').value || null,
    category: category,
    scenario: document.getElementById('rf-scenario').value || null,
    description: document.getElementById('rf-description').value.trim(),
    evidence_level: document.getElementById('rf-evidence').value || null,
    priority: parseInt(document.getElementById('rf-priority').value) || 0,
    enabled: document.getElementById('rf-enabled').checked,
    conditions: [],
    actions: []
  };

  document.querySelectorAll('#conditions-container .condition-row').forEach(function(row) {
    var field = row.querySelector('.cond-field').value;
    var operator = row.querySelector('.cond-op').value;
    var value = row.querySelector('.cond-value').value.trim() || 'all';
    var weight = parseInt(row.querySelector('.cond-weight').value) || 1;
    if (field) data.conditions.push({ field: field, operator: operator, value: value, weight: weight });
  });

  // sort_order：库里带来的原值一律保留，只有本次新增的行才排到已有最大值之后。
  // 原来无条件写成行号 idx，会把种子规则里预留的间隔（如 10、20）压成 0、1，
  // 以后想往中间插一条动作就没有空位可用了。
  var maxSort = -1;
  document.querySelectorAll('#actions-container .action-row').forEach(function(row) {
    var actionType = row.querySelector('.action-type').value;
    var content = row.querySelector('.action-content').value.trim();
    if (!actionType || !content) return;
    var kept = parseInt(row.getAttribute('data-sort'), 10);
    var sort = Number.isFinite(kept) ? kept : null;
    if (sort !== null && sort > maxSort) maxSort = sort;
    data.actions.push({ action_type: actionType, content: content, sort_order: sort });
  });
  data.actions.forEach(function(a) {
    if (a.sort_order === null) a.sort_order = ++maxSort;
  });

  if (data.conditions.length === 0) { showToast('至少需要一个匹配条件', 'error'); return; }
  if (data.actions.length === 0) { showToast('至少需要一个输出动作', 'error'); return; }

  var method = State.editingRuleId ? 'PUT' : 'POST';
  var url = State.editingRuleId ? RULES_API + '/groups/' + State.editingRuleId : RULES_API + '/groups';

  // 连点两次就是两条同名规则（POST 没有唯一约束）⇒ 请求在飞时把按钮锁住
  var saveBtn = document.getElementById('rule-save-btn');
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  var unlock = function() { saveBtn.disabled = false; };

  apiCall(url, method, data).then(function(res) {
    unlock();
    if (res.success) {
      showToast(State.editingRuleId ? '规则更新成功' : '规则创建成功', 'success');
      closeRuleModal();
      loadRules();
      loadStats();
    } else {
      showToast('保存失败: ' + res.message, 'error');
    }
  }).catch(function(e) { unlock(); showToast('保存失败: ' + e.message, 'error'); });
});

/* ── 启用/停用/删除规则 ──
   toggle 后端是"翻转"语义，不是"设成某值"。10-12 起翻转在 SQL 里一次算完
   （routes/rules.js:679 SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END），
   连点两次＝净翻两下，不再出现"第二次在第一次落库前读到旧 enabled ⇒ 结果看运气"。
   下面这把按规则 id 的在飞闸保留：它挡的是重复提交本身，省一次往返也少一次列表刷新。 */
var _ruleBusy = {};

function ruleBusy(key) {
  if (_ruleBusy[key]) return true;
  _ruleBusy[key] = true;
  return false;
}

function ruleFree(key) {
  delete _ruleBusy[key];
}

function toggleRule(ruleId) {
  if (ruleBusy('toggle-' + ruleId)) return;
  apiCall(RULES_API + '/groups/' + ruleId + '/toggle', 'POST').then(function(res) {
    ruleFree('toggle-' + ruleId);
    if (res.success) { showToast(res.message, 'success'); loadRules(); }
    else { showToast('操作失败: ' + res.message, 'error'); }
  }).catch(function(e) {
    ruleFree('toggle-' + ruleId);
    // 原来没有 catch：网络断了或服务没起来时点「停用」什么都没有，按钮像坏了
    showToast('操作失败: ' + e.message, 'error');
  });
}

function deleteRule(ruleId) {
  if (!confirm('确定删除此规则？此操作不可撤销。')) return;
  if (ruleBusy('del-' + ruleId)) return;
  apiCall(RULES_API + '/groups/' + ruleId, 'DELETE').then(function(res) {
    ruleFree('del-' + ruleId);
    if (res.success) { showToast('规则已删除', 'success'); loadRules(); loadStats(); }
    else { showToast('删除失败: ' + res.message, 'error'); }
  }).catch(function(e) {
    ruleFree('del-' + ruleId);
    showToast('删除失败: ' + e.message, 'error');
  });
}

/* ── 规则试算 ── */
function openPreviewModal() {
  if (!RULE_SCHEMA) {
    ensureSchema(function(ok) {
      if (ok) { openPreviewModal(); return; }
      showToast('规则元数据没拿到，试算打不开，请先在规则列表点「重试」', 'error');
    });
    return;
  }
  var scenarioOpts = RULE_SCHEMA.scenarios.map(function(s) {
    return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
  }).join('');
  document.getElementById('preview-modal-body').innerHTML =
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
      '<button class="btn btn-sm btn-primary" id="pv-tab-form" onclick="switchPreviewInput(\'form\')">📋 表单输入</button>' +
      '<button class="btn btn-sm" id="pv-tab-json" onclick="switchPreviewInput(\'json\')">{ } JSON输入</button>' +
    '</div>' +
    '<div id="pv-form-area">' +
      '<div class="form-row">' +
        '<div class="form-group"><label>性别</label><select id="pv-gender"><option value="女">女</option><option value="男">男</option></select></div>' +
        '<div class="form-group"><label>肤色</label><select id="pv-skin"><option value="暖皮">暖皮</option><option value="冷皮">冷皮</option><option value="自然">自然</option></select></div>' +
        '<div class="form-group"><label>脸型</label><select id="pv-face"><option value="圆脸">圆脸</option><option value="方脸">方脸</option><option value="心形脸">心形脸</option><option value="鹅蛋脸">鹅蛋脸</option><option value="长脸">长脸</option></select></div>' +
        '<div class="form-group"><label>场景</label><select id="pv-scenario"><option value="通勤">通勤</option><option value="约会">约会</option><option value="面试">面试</option><option value="休闲">休闲</option><option value="聚会">聚会</option></select></div>' +
      '</div>' +
      '<div class="form-group"><label>拍照场景（只影响"姿势"类推荐）</label><select id="pv-photo_scene"><option value="">不指定</option>' + scenarioOpts + '</select></div>' +
      '<div class="form-group"><label>推荐模式</label><select id="pv-mode"><option value="store">门店模式</option><option value="personal">个人衣橱</option></select></div>' +
    '</div>' +
    '<div id="pv-json-area" style="display:none;">' +
      '<div class="form-group"><label>测试 Profile（JSON格式，支持任意字段如 body_type / region / age_range 等）</label>' +
        '<textarea id="pv-json" rows="8" style="font-family:SF Mono,Consolas,monospace;font-size:12px;">{"gender":"女","skin_tone":"暖皮","face_shape":"圆脸","scenario":"通勤"}</textarea>' +
      '</div>' +
      '<div class="form-group"><label>推荐模式</label><select id="pv-mode-json"><option value="store">门店模式</option><option value="personal">个人衣橱</option></select></div>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="runPreview()" style="width:100%;">🧪 开始试算</button>' +
    '<div id="preview-result" style="margin-top:16px;"></div>';
  document.getElementById('preview-modal').classList.add('open');
}

function switchPreviewInput(type) {
  var formArea = document.getElementById('pv-form-area');
  var jsonArea = document.getElementById('pv-json-area');
  var tabForm = document.getElementById('pv-tab-form');
  var tabJson = document.getElementById('pv-tab-json');
  if (type === 'form') {
    formArea.style.display = ''; jsonArea.style.display = 'none';
    tabForm.classList.add('btn-primary'); tabJson.classList.remove('btn-primary');
  } else {
    formArea.style.display = 'none'; jsonArea.style.display = '';
    tabForm.classList.remove('btn-primary'); tabJson.classList.add('btn-primary');
  }
}

function closePreviewModal() {
  document.getElementById('preview-modal').classList.remove('open');
}

function runPreview() {
  var jsonArea = document.getElementById('pv-json-area');
  var profile, mode;
  if (jsonArea && jsonArea.style.display !== 'none') {
    try { profile = JSON.parse(document.getElementById('pv-json').value); }
    catch (e) {
      document.getElementById('preview-result').innerHTML = '<div class="error-msg">JSON 解析失败: ' + escapeHtml(e.message) + '</div>';
      return;
    }
    mode = document.getElementById('pv-mode-json').value;
  } else {
    profile = {
      gender: document.getElementById('pv-gender').value,
      skin_tone: document.getElementById('pv-skin').value,
      face_shape: document.getElementById('pv-face').value,
      scenario: document.getElementById('pv-scenario').value,
      photo_scene: document.getElementById('pv-photo_scene').value,
    };
    mode = document.getElementById('pv-mode').value;
  }

  var resultDiv = document.getElementById('preview-result');
  resultDiv.innerHTML = '<div class="loading">试算中...</div>';

  apiCall(RULES_API + '/preview', 'POST', { profile: profile, mode: mode }).then(function(res) {
    if (res.success) {
      var rec = (res.data && res.data.recommendation) || {};
      var html = '<div class="rule-section-label">试算结果</div>';
      ['穿搭', '妆容', '发型', '配饰', '姿势'].forEach(function(cat) {
        if (rec[cat] && rec[cat].length > 0) {
          html += '<div class="card" style="padding:12px;margin-bottom:8px;">';
          html += '<div style="font-weight:600;color:var(--accent);margin-bottom:6px;">' + (CATEGORY_LABELS[cat] || cat) + ' (' + rec[cat].length + '条)</div>';
          rec[cat].forEach(function(item) {
            html += '<div style="font-size:12px;margin-bottom:4px;padding:4px 8px;background:var(--bg);border-radius:4px;">';
            html += '<div style="color:var(--muted);margin-bottom:2px;">[' + escapeHtml(item.group_name || '') + ' · ' + (item.score || 0) + '分] ' + evidenceBadge(item.evidence_level) + '</div>';
            // 引擎把动作平铺在条目上(item.top_style),没有 item.actions 这个键
            Object.keys(item).forEach(function(k) {
              if (PREVIEW_META_KEYS[k]) return;
              var v = item[k];
              if (v === null || v === undefined || v === '') return;
              if (typeof v === 'object') v = JSON.stringify(v);
              html += '<span style="color:var(--orange);">' + escapeHtml(ACTION_LABEL_MAP[k] || k) + '：</span>' +
                '<span style="color:var(--green);">' + escapeHtml(String(v)) + '</span><br>';
            });
            // 色度学贴合分:上衣结论认得出色名（或至少认得出"深/浅"这一档）且档案有肤色档时才有
            if (item.color_fit) {
              var f = item.color_fit;
              // 10-20：这一分的来路（basis）要在后台看得见——L5 明度档那条没有 hex，
              // ΔE00/色相角/明度差全是 null，照原样印就是「ΔE00 null、色相角差 null°」，
              // 看起来像系统坏了，实际是"这句文案只说了深浅，没给具体色"。
              var BASIS_CN = {
                hex: '直接色值', 'table-key': '色名精确', 'strip-color': '去尾色字',
                'add-color': '补尾色字', synonym: '同义词归一', 'in-text': '句内扫描',
                'lab-object': 'Lab 直传', 'lightness-band': '仅明度档位',
              };
              var basisTxt = BASIS_CN[f.basis] || f.basis || '未标注';
              if (f.basis === 'lightness-band') {
                html += '<span style="color:var(--orange);">上衣贴合度：</span>' +
                  '<span style="color:var(--green);">' + escapeHtml(f.score + '/100（' + f.top_label +
                    '·' + basisTxt + '，无具体色 ⇒ 只按衣装明度方向给分，不测色差）') + '</span><br>';
              } else {
                // {L,a,b} 直传没有 hex 可印（改前这里会印出 "null"）
                var hexTxt = f.top_hex ? ' ' + f.top_hex : '';
                html += '<span style="color:var(--orange);">上衣贴合度：</span>' +
                  '<span style="color:var(--green);">' + escapeHtml(f.score + '/100（' + f.top_label + hexTxt +
                    '·' + basisTxt + '，与肤色 ΔE00 ' + f.deltaE00 + '、色相角差 ' + f.dHue + '°、明度差 ' + f.dL + '）') + '</span><br>';
              }
            }
            // 身材贴合分:这件上衣的修形方向 vs 这个人的比例偏差(缺测的轴不进总分)
            if (item.body_fit) {
              var b = item.body_fit;
              var ax = (b.axes || []).map(function (a) {
                return a.name_cn + ' ' + Math.round(a.score * 100);
              }).join(' / ');
              html += '<span style="color:var(--orange);">上衣身材适配度：</span>' +
                '<span style="color:var(--green);">' + escapeHtml(b.score + '/100（' + ax +
                  '；未计入 ' + (b.axes_missing || []).length + ' 维）') + '</span><br>';
            }
            // 综合排序分：名次就是它决定的（10-19 第二阶段「换脑」），三个分量与缺测折扣都要摊开
            if (item.rank) {
              var rk = item.rank;
              var dd = (rk.dims || []).filter(function (d) {
                return d.score !== null && d.score !== undefined && d.weight > 0;
              }).map(function (d) {
                return d.name_cn + ' ' + Math.round(d.score) + '×' + Math.round(d.weight * 100) / 100;
              }).join(' + ');
              var noDim = (rk.dims || []).filter(function (d) {
                return !(d.score !== null && d.score !== undefined && d.weight > 0);
              }).map(function (d) { return d.name_cn; });
              html += '<span style="color:var(--orange);">综合排序分：</span>' +
                '<span style="color:var(--green);">' + escapeHtml(rk.score + '/100（' + dd +
                  '，实测覆盖折扣 ' + rk.coverage + '⇒乘 ' + rk.factor +
                  (noDim.length ? '；没算:' + noDim.join('、') : '') + '）') + '</span><br>';
            }
            html += '</div>';
          });
          html += '</div>';
        }
      });
      if (rec.inventory) {
        html += '<div class="card" style="padding:12px;"><div style="font-weight:600;color:var(--orange);">📦 库存匹配</div>';
        html += '<pre style="font-size:11px;overflow:auto;">' + escapeHtml(JSON.stringify(rec.inventory, null, 2)) + '</pre></div>';
      }
      if (!['穿搭', '妆容', '发型', '配饰', '姿势'].some(function(c) { return (rec[c] || []).length > 0; })) {
        html += '<div style="color:var(--muted);text-align:center;padding:20px;">未匹配到任何规则</div>';
      }
      resultDiv.innerHTML = html;
    } else {
      resultDiv.innerHTML = '<div class="error-msg">试算失败: ' + escapeHtml(res.message) + '</div>';
    }
  }).catch(function(e) {
    resultDiv.innerHTML = '<div class="error-msg">试算失败: ' + escapeHtml(e.message) + '</div>';
  });
}
