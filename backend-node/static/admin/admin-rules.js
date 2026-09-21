/* ══════════════════════════════════════════════════════════════
   管理后台 — 规则编辑器模块

   功能：规则列表/筛选/新建/编辑/启用停用/删除/试算
   依赖: admin-utils.js（State, fetchJSON, apiCall, escapeHtml, showToast,
         CATEGORY_LABELS, RULES_API）
   ══════════════════════════════════════════════════════════════ */

/* ── 筛选事件绑定 ── */
['filter-mode', 'filter-gender', 'filter-category', 'filter-scenario', 'filter-enabled'].forEach(function(id) {
  document.getElementById(id).addEventListener('change', loadRules);
});
document.getElementById('rules-refresh').addEventListener('click', loadRules);
document.getElementById('rules-create-btn').addEventListener('click', function() { openRuleModal(null); });
document.getElementById('rules-preview-btn').addEventListener('click', openPreviewModal);

/* ── 加载规则列表 ── */
function loadRules() {
  var container = document.getElementById('rules-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  var params = [];
  var mode = document.getElementById('filter-mode').value;
  var gender = document.getElementById('filter-gender').value;
  var category = document.getElementById('filter-category').value;
  var scenario = document.getElementById('filter-scenario').value;
  var enabled = document.getElementById('filter-enabled').value;

  if (mode) params.push('mode=' + mode);
  if (gender) params.push('gender=' + encodeURIComponent(gender));
  if (category) params.push('category=' + encodeURIComponent(category));
  if (scenario) params.push('scenario=' + encodeURIComponent(scenario));
  if (enabled) params.push('enabled=' + enabled);

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
      var val = c.value;
      if (typeof val === 'object' && val !== null) val = val[c.field] || JSON.stringify(val);
      return escapeHtml(c.field) + '=' + escapeHtml(val);
    }).join('，');

    var actionSummary = (g.actions || []).map(function(a) { return escapeHtml(a.action_type); }).join(' / ');

    var header = document.createElement('div');
    header.className = 'rule-header';
    header.innerHTML =
      '<span class="rule-name">' + escapeHtml(g.name) + '</span>' +
      '<span class="rule-meta">' +
        '<span class="badge badge-accent">' + escapeHtml(CATEGORY_LABELS[g.category] || g.category) + '</span>' +
        (g.gender ? '<span class="badge badge-purple">' + escapeHtml(g.gender) + '</span>' : '') +
        (g.scenario ? '<span class="badge badge-green">' + escapeHtml(g.scenario) + '</span>' : '') +
        '<span class="badge ' + (g.enabled ? 'badge-green' : 'badge-red') + '">' + (g.enabled ? '启用' : '停用') + '</span>' +
        (g.priority ? '<span class="badge badge-orange">P' + g.priority + '</span>' : '') +
        '<span class="badge" style="background:var(--bg);color:var(--muted);" title="命中次数">🎯 命中 ' + (g.hit_count || 0) + '</span>' +
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
  html += '<div class="form-group"><label>推荐模式</label><select id="rf-mode"><option value="store"' + (g.mode === 'store' ? ' selected' : '') + '>门店模式</option><option value="personal"' + (g.mode === 'personal' ? ' selected' : '') + '>个人衣橱</option></select></div>';
  html += '<div class="form-group"><label>性别</label><select id="rf-gender"><option value="">不限</option><option value="女"' + (g.gender === '女' ? ' selected' : '') + '>女</option><option value="男"' + (g.gender === '男' ? ' selected' : '') + '>男</option></select></div>';
  html += '<div class="form-group"><label>推荐类别 <span class="req">*</span></label><select id="rf-category"><option value="穿搭"' + (g.category === '穿搭' ? ' selected' : '') + '>穿搭</option><option value="妆容"' + (g.category === '妆容' ? ' selected' : '') + '>美妆</option><option value="发型"' + (g.category === '发型' ? ' selected' : '') + '>发型</option><option value="配饰"' + (g.category === '配饰' ? ' selected' : '') + '>配饰</option></select></div>';
  html += '<div class="form-group"><label>场景</label><select id="rf-scenario"><option value="">不限</option><option value="通勤"' + (g.scenario === '通勤' ? ' selected' : '') + '>通勤</option><option value="约会"' + (g.scenario === '约会' ? ' selected' : '') + '>约会</option><option value="面试"' + (g.scenario === '面试' ? ' selected' : '') + '>面试</option><option value="休闲"' + (g.scenario === '休闲' ? ' selected' : '') + '>休闲</option><option value="聚会"' + (g.scenario === '聚会' ? ' selected' : '') + '>聚会</option></select></div>';
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

function buildConditionRow(c, idx) {
  var val = c.value;
  if (typeof val === 'object' && val !== null) val = val[c.field] || '';
  return '<div class="condition-row" data-idx="' + idx + '">' +
    '<select class="cond-field"><option value="skin_tone"' + (c.field === 'skin_tone' ? ' selected' : '') + '>肤色</option><option value="face_shape"' + (c.field === 'face_shape' ? ' selected' : '') + '>脸型</option><option value="body_type"' + (c.field === 'body_type' ? ' selected' : '') + '>体型</option><option value="scenario"' + (c.field === 'scenario' ? ' selected' : '') + '>场景</option><option value="gender"' + (c.field === 'gender' ? ' selected' : '') + '>性别</option></select>' +
    '<select class="cond-op"><option value="eq"' + (c.operator === 'eq' ? ' selected' : '') + '>等于</option><option value="ne"' + (c.operator === 'ne' ? ' selected' : '') + '>不等于</option><option value="in"' + (c.operator === 'in' ? ' selected' : '') + '>包含于</option></select>' +
    '<input type="text" class="cond-value" value="' + escapeHtml(String(val)) + '" placeholder="值（all=不限）">' +
    '<input type="number" class="cond-weight" value="' + (c.weight || 1) + '" style="flex:0 0 60px;" title="权重">' +
    '<button class="remove-row-btn" onclick="this.parentElement.remove()">×</button>' +
    '</div>';
}

function buildActionRow(a, idx) {
  return '<div class="action-row" data-idx="' + idx + '">' +
    '<select class="action-type">' +
    '<option value="top_style"' + (a.action_type === 'top_style' ? ' selected' : '') + '>上装风格</option>' +
    '<option value="bottom_style"' + (a.action_type === 'bottom_style' ? ' selected' : '') + '>下装风格</option>' +
    '<option value="shoe_style"' + (a.action_type === 'shoe_style' ? ' selected' : '') + '>鞋履风格</option>' +
    '<option value="color_combo"' + (a.action_type === 'color_combo' ? ' selected' : '') + '>配色方案</option>' +
    '<option value="妆容风格"' + (a.action_type === '妆容风格' ? ' selected' : '') + '>妆容风格</option>' +
    '<option value="lip_color"' + (a.action_type === 'lip_color' ? ' selected' : '') + '>唇色</option>' +
    '<option value="foundation"' + (a.action_type === 'foundation' ? ' selected' : '') + '>粉底</option>' +
    '<option value="eye_shadow"' + (a.action_type === 'eye_shadow' ? ' selected' : '') + '>眼影</option>' +
    '<option value="blush"' + (a.action_type === 'blush' ? ' selected' : '') + '>腮红</option>' +
    '<option value="eyebrow"' + (a.action_type === 'eyebrow' ? ' selected' : '') + '>眉型</option>' +
    '<option value="skincare"' + (a.action_type === 'skincare' ? ' selected' : '') + '>护肤</option>' +
    '<option value="technique"' + (a.action_type === 'technique' ? ' selected' : '') + '>技巧</option>' +
    '<option value="发型"' + (a.action_type === '发型' ? ' selected' : '') + '>发型</option>' +
    '<option value="hair_color"' + (a.action_type === 'hair_color' ? ' selected' : '') + '>发色</option>' +
    '<option value="bang_type"' + (a.action_type === 'bang_type' ? ' selected' : '') + '>刘海</option>' +
    '<option value="hair_length"' + (a.action_type === 'hair_length' ? ' selected' : '') + '>发长</option>' +
    '<option value="avoid"' + (a.action_type === 'avoid' ? ' selected' : '') + '>避免</option>' +
    '<option value="earring_type"' + (a.action_type === 'earring_type' ? ' selected' : '') + '>耳饰</option>' +
    '<option value="necklace_type"' + (a.action_type === 'necklace_type' ? ' selected' : '') + '>项链</option>' +
    '<option value="glasses_type"' + (a.action_type === 'glasses_type' ? ' selected' : '') + '>眼镜</option>' +
    '<option value="bag_style"' + (a.action_type === 'bag_style' ? ' selected' : '') + '>包包</option>' +
    '<option value="metal_color"' + (a.action_type === 'metal_color' ? ' selected' : '') + '>金属色</option>' +
    '<option value="reason"' + (a.action_type === 'reason' ? ' selected' : '') + '>推荐理由</option>' +
    '<option value="custom"' + (a.action_type === 'custom' ? ' selected' : '') + '>自定义</option>' +
    '</select>' +
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
    };
    mode = document.getElementById('pv-mode').value;
  }

  var resultDiv = document.getElementById('preview-result');
  resultDiv.innerHTML = '<div class="loading">试算中...</div>';

  apiCall(RULES_API + '/preview', 'POST', { profile: profile, mode: mode }).then(function(res) {
    if (res.success) {
      var rec = res.data.recommendation;
      var html = '<div class="rule-section-label">试算结果</div>';
      ['穿搭', '妆容', '发型', '配饰'].forEach(function(cat) {
        if (rec[cat] && rec[cat].length > 0) {
          html += '<div class="card" style="padding:12px;margin-bottom:8px;">';
          html += '<div style="font-weight:600;color:var(--accent);margin-bottom:6px;">' + (CATEGORY_LABELS[cat] || cat) + ' (' + rec[cat].length + '条)</div>';
          rec[cat].forEach(function(item) {
            html += '<div style="font-size:12px;margin-bottom:4px;padding:4px 8px;background:var(--bg);border-radius:4px;">';
            html += '<span style="color:var(--muted);">[' + (item.group_name || '') + ']</span> ';
            var firstKey = Object.keys(item).find(function(k) { return k !== 'group_id' && k !== 'group_name' && k !== 'priority' && k !== 'score'; });
            if (firstKey) html += '<span style="color:var(--green);">' + escapeHtml(item[firstKey]) + '</span>';
            html += '</div>';
          });
          html += '</div>';
        }
      });
      if (rec.inventory) {
        html += '<div class="card" style="padding:12px;"><div style="font-weight:600;color:var(--orange);">📦 库存匹配</div>';
        html += '<pre style="font-size:11px;overflow:auto;">' + escapeHtml(JSON.stringify(rec.inventory, null, 2)) + '</pre></div>';
      }
      if (!rec['穿搭']?.length && !rec['妆容']?.length && !rec['发型']?.length && !rec['配饰']?.length) {
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
