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
var FIELD_LABEL_MAP = {};
var ACTION_LABEL_MAP = {};
var TAG_LABEL_MAP = {};
var PART_LABEL_MAP = {};
/** 依据档位:标签/说明/下拉项都由 /api/rules/schema 下发,与 services/evidenceLevels.js 同源 */
var EVIDENCE_LABEL_MAP = {};
var EVIDENCE_NOTE_MAP = {};
var EVIDENCE_OPTIONS = [];
/** 徽章配色:A 硬指标绿、B 实证蓝、C 体系橙、D 命理灰紫、未标注灰 */
var EVIDENCE_BADGE_CLASS = { A: 'badge-green', B: 'badge-accent', C: 'badge-orange', D: 'badge-purple' };
/** 试算渲染时要跳过的非动作字段(引擎附带的分组元信息与派生分) */
var PREVIEW_META_KEYS = {
  group_id: 1, group_name: 1, priority: 1, score: 1, explanation: 1,
  evidence_level: 1, color_fit: 1, body_fit: 1, feedback: 1, condition_details: 1,
};

function ensureSchema(done) {
  if (RULE_SCHEMA) { done(); return; }
  fetchJSON(RULES_API + '/schema').then(function(res) {
    if (!res.success) throw new Error(res.message);
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
    done();
  }).catch(function(e) {
    showToast('规则元数据加载失败: ' + e.message, 'error');
    done();
  });
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
function loadRules() {
  if (!RULE_SCHEMA) { ensureSchema(loadRules); return; }
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
    if (!res.success) throw new Error(res.message);
    State.rules = res.data.groups;
    renderRules(res.data.groups);
    document.getElementById('rules-count').textContent = '共 ' + (res.data.total !== undefined ? res.data.total : res.data.groups.length) + ' 条规则';
  }).catch(function(e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ── 依据档位徽章：库里存 A/B/C/D，NULL 显示"未标注" ── */
function evidenceBadge(level) {
  var v = level || 'none';
  var label = EVIDENCE_LABEL_MAP[v] || (level ? level + ' 档' : '未标注');
  var note = EVIDENCE_NOTE_MAP[v] || '未标注：后台手工建或前缀认不出来';
  var cls = EVIDENCE_BADGE_CLASS[v] || '';
  var style = cls ? '' : ' style="background:var(--bg);color:var(--muted);border:1px dashed var(--border);"';
  return '<span class="badge ' + cls + '"' + style + ' title="' + escapeHtml(note) + '">依据 ' + escapeHtml(level || '未标注') + '</span>';
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
        '<span class="badge badge-accent">' + escapeHtml(CATEGORY_LABELS[g.category] || g.category) + '</span>' +
        (g.tag ? '<span class="badge badge-purple" title="' + escapeHtml(g.source_key || '') + '">' + escapeHtml(TAG_LABEL_MAP[g.tag] || g.tag) + '</span>' : '') +
        evidenceBadge(g.evidence_level) +
        (g.gender ? '<span class="badge badge-purple">' + escapeHtml(g.gender) + '</span>' : '') +
        (g.scenario ? '<span class="badge badge-green">' + escapeHtml(g.scenario) + '</span>' : '') +
        '<span class="badge ' + (g.enabled ? 'badge-green' : 'badge-red') + '">' + (g.enabled ? '启用' : '停用') + '</span>' +
        (g.priority ? '<span class="badge badge-orange">P' + g.priority + '</span>' : '') +
        '<span class="badge" style="background:var(--bg);color:var(--muted);" title="命中次数/最近命中时间">🎯 命中 ' + (g.hit_count || 0) + (g.last_hit_at ? ' · 最近 ' + g.last_hit_at.slice(0, 10) : ' · 从未命中') + '</span>' +
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
  if (!RULE_SCHEMA) { ensureSchema(function() { openRuleModal(ruleId); }); return; }
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

  html += '<div class="form-group" style="margin-top:14px;"><label><input type="checkbox" id="rf-enabled"' + (g.enabled !== false ? ' checked' : '') + '> 启用此规则</label></div>';
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
  return '<div class="action-row" data-idx="' + idx + '">' +
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
  div.innerHTML = buildActionRow({ action_type: 'reason', content: '', sort_order: container.children.length }, container.children.length);
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

  document.querySelectorAll('#actions-container .action-row').forEach(function(row, idx) {
    var actionType = row.querySelector('.action-type').value;
    var content = row.querySelector('.action-content').value.trim();
    if (actionType && content) data.actions.push({ action_type: actionType, content: content, sort_order: idx });
  });

  if (data.conditions.length === 0) { showToast('至少需要一个匹配条件', 'error'); return; }
  if (data.actions.length === 0) { showToast('至少需要一个输出动作', 'error'); return; }

  var method = State.editingRuleId ? 'PUT' : 'POST';
  var url = State.editingRuleId ? RULES_API + '/groups/' + State.editingRuleId : RULES_API + '/groups';

  apiCall(url, method, data).then(function(res) {
    if (res.success) {
      showToast(State.editingRuleId ? '规则更新成功' : '规则创建成功', 'success');
      closeRuleModal();
      loadRules();
      loadStats();
    } else {
      showToast('保存失败: ' + res.message, 'error');
    }
  }).catch(function(e) { showToast('保存失败: ' + e.message, 'error'); });
});

/* ── 启用/停用/删除规则 ── */
function toggleRule(ruleId) {
  apiCall(RULES_API + '/groups/' + ruleId + '/toggle', 'POST').then(function(res) {
    if (res.success) { showToast(res.message, 'success'); loadRules(); }
    else { showToast('操作失败: ' + res.message, 'error'); }
  });
}

function deleteRule(ruleId) {
  if (!confirm('确定删除此规则？此操作不可撤销。')) return;
  apiCall(RULES_API + '/groups/' + ruleId, 'DELETE').then(function(res) {
    if (res.success) { showToast('规则已删除', 'success'); loadRules(); loadStats(); }
    else { showToast('删除失败: ' + res.message, 'error'); }
  });
}

/* ── 规则试算 ── */
function openPreviewModal() {
  if (!RULE_SCHEMA) { ensureSchema(openPreviewModal); return; }
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
      var rec = res.data.recommendation;
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
            // 色度学贴合分:只有上衣结论认得出色名且档案有肤色档时才有
            if (item.color_fit) {
              var f = item.color_fit;
              html += '<span style="color:var(--orange);">上衣贴合度：</span>' +
                '<span style="color:var(--green);">' + escapeHtml(f.score + '/100（' + f.top_label + ' ' + f.top_hex +
                  '，与肤色 ΔE00 ' + f.deltaE00 + '、色相角差 ' + f.dHue + '°、明度差 ' + f.dL + '）') + '</span><br>';
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
