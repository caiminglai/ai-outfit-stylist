/* ══════════════════════════════════════════════════════════════
   管理后台 — 3D模型管理模块

   功能:模型列表/筛选/扫描/启用禁用/编辑/曝光值排序
   依赖: admin-utils.js(State, fetchJSON, apiCall, escapeHtml, showToast, MODELS_API)
   ══════════════════════════════════════════════════════════════ */

/* ── 事件绑定 ── */
document.getElementById('models-scan-btn').addEventListener('click', rescanModels);
document.getElementById('models-enable-all-btn').addEventListener('click', enableAllModels);
document.getElementById('model-filter-source').addEventListener('change', renderModels);
document.getElementById('model-filter-status').addEventListener('change', renderModels);
document.getElementById('model-search').addEventListener('input', function () {
  clearTimeout(window._modelSearchTimer);
  window._modelSearchTimer = setTimeout(renderModels, 300);
});

/* ── 角色名提取(展示第一行) ── */
// 命名格式: name="角色名-游戏名[作者]", desc="游戏名[作者]"
// 若 name 以 "-" + desc 结尾, 去掉该后缀得到角色名; 否则返回完整 name
function extractRoleName(name, desc) {
  if (!name) return '';
  if (desc) {
    var suffix = '-' + desc;
    if (name.lastIndexOf(suffix) === name.length - suffix.length) {
      return name.substring(0, name.length - suffix.length);
    }
  }
  return name;
}

/* ── 加载模型列表 ── */
function loadModels() {
  var container = document.getElementById('models-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  fetchJSON(MODELS_API + '/admin/list').then(function (res) {
    if (!res.success) throw new Error(res.message);
    // res.data 可能是 null(success:true 但空返回),直接赋给 State.models 会让后续
    // renderModels/enableAllModels 的 State.models.filter 抛未捕获 TypeError ⇒ 兜成 []
    State.models = res.data || [];
    renderModels();
    var total = State.models.length;
    var enabledCount = State.models.filter(function (m) { return m.enabled; }).length;
    document.getElementById('models-count').textContent = '共 ' + total + ' 个模型(已启用 ' + enabledCount + ' 个)';
    document.getElementById('stat-models').textContent = enabledCount + '/' + total;
  }).catch(function (e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ── 扫描模型目录 ── */
function rescanModels() {
  var container = document.getElementById('models-container');
  container.className = 'loading';
  container.textContent = '正在扫描模型目录...';

  apiCall(MODELS_API + '/admin/scan', 'POST').then(function (res) {
    if (!res.success) throw new Error(res.message);
    // 新格式: { models: [...], stats: { total, new, skipped } }
    // 兼容旧格式: 直接数组
    var scanData = res.data;
    var models, stats;
    if (Array.isArray(scanData)) {
      models = scanData;
      stats = { total: models.length, new: 0, skipped: 0 };
    } else {
      models = scanData.models || [];
      stats = scanData.stats || { total: models.length, new: 0, skipped: 0 };
    }
    State.models = models;
    renderModels();
    var total = models.length;
    var enabledCount = models.filter(function (m) { return m.enabled; }).length;
    document.getElementById('models-count').textContent = '共 ' + total + ' 个模型(已启用 ' + enabledCount + ' 个)';
    document.getElementById('stat-models').textContent = enabledCount + '/' + total;
    var msg = '扫描完成：共 ' + stats.total + ' 个模型';
    if (stats.new > 0) msg += '，新发现 ' + stats.new + ' 个';
    if (stats.skipped > 0) msg += '，跳过 ' + stats.skipped + ' 个已存在';
    showToast(msg, 'success');
  }).catch(function (e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">扫描失败: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ── 批量启用全部模型 ── */
// toggle 是"翻转"语义(models.js:299,10-12 起翻转在 SQL 里一次算完:CASE WHEN enabled=1
// THEN 0 ELSE 1 END)而非"置为启用"。原来后端先 SELECT 再写回,连点会双翻;现在不会了,
// 但每个模型仍以接口回显的 res.data.enabled 为准,不能写死 true。
// 下面这个在途闸保留:它挡的是同一批重复提交,省一轮往返和一次整页重绘。
var _enableAllInflight = false
function enableAllModels() {
  if (_enableAllInflight) { showToast('批量启用正在进行中…', 'info'); return; }
  if (!confirm('确定要启用全部模型吗?')) return;
  var pending = State.models.filter(function (m) { return !m.enabled; });
  if (pending.length === 0) { showToast('所有模型已启用', 'success'); return; }

  _enableAllInflight = true;
  var completed = 0, failed = 0;
  pending.forEach(function (m) {
    // 批量跑期间把这一条也记进单卡在途闸：否则管理员在等待的空档点同一张卡的
    // 「启用/禁用」，那条模型就被翻了两次（批量一次 + 手点一次），回显相互覆盖。
    var key = String(m.id);
    _toggleInflight[key] = true;
    apiCall(MODELS_API + '/admin/' + m.id + '/toggle', 'POST').then(function (res) {
      if (res.success) { m.enabled = !!(res.data && res.data.enabled); completed++; } else { failed++; }
    }).catch(function () { failed++; }).finally(function () {
      delete _toggleInflight[key];
      if (completed + failed === pending.length) {
        _enableAllInflight = false;
        renderModels();
        var enabledCount = State.models.filter(function (m) { return m.enabled; }).length;
        document.getElementById('models-count').textContent = '共 ' + State.models.length + ' 个模型(已启用 ' + enabledCount + ' 个)';
        document.getElementById('stat-models').textContent = enabledCount + '/' + State.models.length;
        showToast('批量启用完成:成功 ' + completed + ' 个,失败 ' + failed + ' 个', failed > 0 ? 'error' : 'success');
      }
    });
  });
}

/* ── 渲染模型卡片 ── */
function renderModels() {
  var container = document.getElementById('models-container');
  container.className = '';

  var source = document.getElementById('model-filter-source').value;
  var status = document.getElementById('model-filter-status').value;
  var search = document.getElementById('model-search').value.trim().toLowerCase();

  var filtered = State.models.filter(function (m) {
    if (source && m.source !== source) return false;
    if (status === 'enabled' && !m.enabled) return false;
    if (status === 'disabled' && m.enabled) return false;
    if (search && m.name.toLowerCase().indexOf(search) === -1) return false;
    return true;
  });

  if (!filtered || filtered.length === 0) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--muted);">暂无模型,点击「扫描模型」发现新模型</div>';
    return;
  }

  // 分组键是 model.source（后台下拉可填、扫描目录名也能带进来的自由文本）⇒ 必须无原型对象。
  // 用 {} 时 source='constructor' 会让 `if (!grouped[m.source])` 顺着原型链拿到 Object 构造器
  // （truthy，挡不住）再去 .push ⇒ TypeError，整页模型渲染当场断；'__proto__' 更糟，
  // 直接把这个普通对象的 prototype 改掉。与本文件 _toggleInflight、admin-rules 的 MAP 同一做法。
  var grouped = Object.create(null);
  filtered.forEach(function (m) { if (!grouped[m.source]) grouped[m.source] = []; grouped[m.source].push(m); });

  container.innerHTML = '';
  Object.keys(grouped).forEach(function (sourceName) {
    var section = document.createElement('div');
    section.innerHTML = '<h3 style="color:var(--accent);margin-bottom:10px;">' + escapeHtml(sourceName) + ' (' + grouped[sourceName].length + ')</h3>';

    grouped[sourceName].forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'model-card' + (m.enabled ? '' : ' disabled');

      var statusBadge = m.enabled ? '<span class="stock-badge stock-in">已启用</span>' : '<span class="stock-badge stock-out">已禁用</span>';

      // 命名格式: name="角色名-游戏名[作者]", desc="游戏名[作者]"
      var roleName = extractRoleName(m.name, m.desc);
      var descText = m.desc || '';

      // 构建预览图或图标显示
      var displayContent = '';
      if (m.image_preview) {
        displayContent = '<img src="' + escapeHtml(m.image_preview) + '" class="model-thumb" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
          '<div class="model-icon-fallback" style="display:none;">' + escapeHtml(m.icon || '🎭') + '</div>';
      } else {
        displayContent = '<div class="model-icon-fallback">' + escapeHtml(m.icon || '🎭') + '</div>';
      }

      // 卡片布局: 左侧图标 + 中间信息 + 右侧操作
      card.innerHTML =
        '<div class="model-card-left">' +
          displayContent +
        '</div>' +
        '<div class="model-card-center">' +
          '<div class="model-card-name">' + escapeHtml(roleName) + ' ' + statusBadge + '</div>' +
          '<div class="model-card-desc">' + (descText ? escapeHtml(descText) : '<span style="opacity:0.4;">无描述</span>') + '</div>' +
        '</div>' +
        '<div class="model-card-right">' +
          '<div class="model-quick-controls">' +
            '<label>曝光<input type="number" class="model-exposure" data-id="' + m.id + '" value="' + (m.exposure === null || m.exposure === undefined ? '' : m.exposure) + '" step="0.1" min="0.1" max="5"></label>' +
            '<label>排序<input type="number" class="model-sort" data-id="' + m.id + '" value="' + (m.sort_order === null || m.sort_order === undefined ? '' : m.sort_order) + '" style="width:50px;"></label>' +
          '</div>' +
          '<div class="model-card-actions">' +
            '<button class="btn btn-sm ' + (m.enabled ? 'btn-red' : 'btn-green') + '" onclick="toggleModel(\'' + m.id + '\')">' + (m.enabled ? '禁用' : '启用') + '</button>' +
            '<button class="btn btn-sm" onclick="editModelName(\'' + m.id + '\')">✏️ 编辑</button>' +
            '<button class="btn btn-sm btn-red" onclick="deleteModel(\'' + m.id + '\')">🗑️</button>' +
          '</div>' +
        '</div>';

      section.appendChild(card);
    });
    container.appendChild(section);
  });

  // 绑定曝光值和排序的修改事件
  // 卡片上的这两个快改框：留空＝不改，与弹窗里那条口径（本文件「曝光值:留空＝不改」一段）一致。
  // 原来写成 parseFloat(this.value) || 0.2 / parseInt(this.value) || 0，管理员把框清空点走
  // 就等于替这个模型写死 0.2 和 0；库里原本是 NULL 的曝光值也被这么坐实成 0.2。
  // 填了但不是数（NaN、"abc"）→ 提示后把框回填成 State.models 里的现值，不发请求。
  function quickEditModel(id) {
    var found = null;
    State.models.forEach(function (m) { if (String(m.id) === String(id)) found = m; });
    return found;
  }
  document.querySelectorAll('.model-exposure').forEach(function (input) {
    input.addEventListener('change', function () {
      var id = this.dataset.id;
      var raw = String(this.value).trim();
      if (raw === '') return;
      var v = parseFloat(raw);
      if (!isFinite(v)) {
        var m1 = quickEditModel(id);
        this.value = m1 && m1.exposure !== null && m1.exposure !== undefined ? m1.exposure : '';
        showToast('曝光值得是个数', 'error');
        return;
      }
      updateModelSetting(id, { exposure: v });
    });
  });
  document.querySelectorAll('.model-sort').forEach(function (input) {
    input.addEventListener('change', function () {
      var id = this.dataset.id;
      var raw = String(this.value).trim();
      if (raw === '') return;
      var v = parseInt(raw, 10);
      if (!isFinite(v)) {
        var m2 = quickEditModel(id);
        this.value = m2 && m2.sort_order !== null && m2.sort_order !== undefined ? m2.sort_order : '';
        showToast('排序得是个整数', 'error');
        return;
      }
      updateModelSetting(id, { sort_order: v });
    });
  });
}

/* ── 启用/禁用模型 ── */
// toggle 接口是"翻转"语义（不是"置为启用"），连点两次 = 翻过去再翻回来，
// 而两次回显各自重绘一次卡片 ⇒ 管理员看到的是"点了没反应"，实际状态绕回了原点。
// 这里按模型 ID 设在途闸：同一个模型两次点击只发一次请求。
var _toggleInflight = Object.create(null);
function toggleModel(modelId) {
  var key = String(modelId);
  if (_toggleInflight[key]) { showToast('这个模型的上一条切换还在路上，稍等', 'info'); return; }
  _toggleInflight[key] = true;
  function done() { delete _toggleInflight[key]; }
  apiCall(MODELS_API + '/admin/' + modelId + '/toggle', 'POST').then(function (res) {
    done();
    if (res.success) {
      var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
      if (model) model.enabled = res.data.enabled;
      renderModels();
      var enabledCount = State.models.filter(function (m) { return m.enabled; }).length;
      document.getElementById('models-count').textContent = '共 ' + State.models.length + ' 个模型(已启用 ' + enabledCount + ' 个)';
      document.getElementById('stat-models').textContent = enabledCount + '/' + State.models.length;
      showToast(res.message, 'success');
    } else { showToast('操作失败: ' + res.message, 'error'); }
  }).catch(function (e) { done(); showToast('操作失败: ' + e.message, 'error'); });
}

/* ── 编辑模型(完整表单弹窗) ── */
function editModelName(modelId) {
  var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
  if (!model) return;

  // 创建弹窗遮罩和内容
  // 弹窗里的控件全靠 id（#edit-name / #edit-icon-input …），同一页面出现两个就重复 id。
  // 遮罩本身是整屏 fixed，正常点不到第二个「编辑」，但重复触发（连点、脚本调用）会留下
  // 旧壳子 ⇒ 先按 class 把在场的旧弹窗摘掉，保证全世界只有最后这一个。
  var stale = document.querySelectorAll('.model-edit-overlay');
  for (var si = 0; si < stale.length; si++) stale[si].remove();
  var overlay = document.createElement('div');
  overlay.className = 'model-edit-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  
  // 词表与 utils/model-utils.js 的 SOURCE_MAP 取值对齐（2026-10-11 现量：那边是
  // '崩坏:星穹铁道' 半角冒号 + 有 '星渊'，这边原来是全角冒号且没有 '星渊'）。
  // select 里没有当前值时浏览器会默认选中第一项 '原神'，管理员只是改个图标点保存，
  // source 就被静默改成原神 ⇒ 当前值不在表内时先补一条自己的。
  var sourceOptions = ['原神','鸣潮','尘白禁区','崩坏:星穹铁道','崩坏3','深空之眼','幻塔','世界计划','战双帕弥什','星渊','VOCALOID','MMD','其他'];
  var currentSource = (model.source || '').trim();
  if (currentSource && sourceOptions.indexOf(currentSource) === -1) sourceOptions.unshift(currentSource);
  // 补进去那条是自由文本（来自 model.source），必须转义后再拼：带个引号就能把
  // value=" 截断，往 option 后面塞属性甚至塞 <script> 片段。
  var sourceSelect = sourceOptions.map(function(s) {
    return '<option value="' + escapeHtml(s) + '"' + (model.source === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
  }).join('');

  var iconPresets = ['🎭','⚔️','🎵','🌸','⚡','🔥','❄️','🌙','⭐','💎','🎨','🌟','💫','🎪'];
  // 图标按钮不再写 inline onclick + document.getElementById：那两个 id 属于弹窗内部，
  // 用全-document 查找等于默认全世界只有一个弹窗。改成挂 class，在 appendChild 之后
  // 于 overlay 自己的作用域里绑定。
  var iconButtons = iconPresets.map(function(ic) {
    return '<button type="button" class="edit-icon-preset" style="padding:4px 8px;margin:2px;border:1px solid #444;background:#222;color:#fff;border-radius:4px;cursor:pointer;font-size:16px;">' + ic + '</button>';
  }).join('');

  overlay.innerHTML = 
    '<div style="background:#1e1e1e;border-radius:12px;padding:24px;width:520px;max-height:90vh;overflow-y:auto;color:#fff;border:1px solid #333;">' +
      '<h3 style="margin:0 0 16px;color:#4fc3f7;font-size:18px;">📝 编辑模型 - ' + escapeHtml(model.name) + '</h3>' +
      
      '<div style="margin-bottom:14px;">' +
        '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">🖼️ 预览图 (URL 或留空使用图标)</label>' +
        '<input id="edit-image-preview" type="text" value="' + escapeHtml(model.image_preview || '') + '" placeholder="输入图片URL, 如 /models/xxx/preview.jpg" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box;">' +
        '<div style="margin-top:6px;">' +
          '<img id="preview-img" src="' + escapeHtml(model.image_preview || '') + '" style="max-width:100%;max-height:120px;border-radius:6px;display:' + (model.image_preview ? 'block' : 'none') + ';border:1px solid #333;">' +
        '</div>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">✏️ 第一行 - 模型名称 (角色名)</label>' +
        '<input id="edit-name" type="text" value="' + escapeHtml(model.name) + '" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;">' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">📋 第二行 - 描述/副标题</label>' +
        '<input id="edit-desc" type="text" value="' + escapeHtml(model.desc || '') + '" placeholder="如: 原神 [作者名]" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box;">' +
      '</div>' +

      '<div style="display:flex;gap:12px;margin-bottom:14px;">' +
        '<div style="flex:1;">' +
          '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">🎮 来源/游戏</label>' +
          '<select id="edit-source" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;">' +
            sourceSelect +
          '</select>' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">🎨 图标 (Emoji)</label>' +
          '<input id="edit-icon-input" type="text" value="' + escapeHtml(model.icon || '🎭') + '" maxlength="4" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:18px;box-sizing:border-box;text-align:center;">' +
        '</div>' +
      '</div>' +
      
      '<div style="margin-bottom:14px;">' +
        '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:6px;">快捷选择图标:</label>' +
        '<div style="display:flex;flex-wrap:wrap;">' + iconButtons + '</div>' +
      '</div>' +

      '<div style="display:flex;gap:12px;margin-bottom:14px;">' +
        '<div style="flex:1;">' +
          '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">☀️ 曝光值</label>' +
          '<input id="edit-exposure" type="number" value="' + (model.exposure === null || model.exposure === undefined ? '' : model.exposure) + '" step="0.1" min="0.1" max="5" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">🔢 排序</label>' +
          '<input id="edit-sort" type="number" value="' + (model.sort_order === null || model.sort_order === undefined ? '' : model.sort_order) + '" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box;">' +
        '</div>' +
      '</div>' +

      '<div style="margin-bottom:8px;padding:10px;background:#2a2a2a;border-radius:6px;font-size:12px;color:#888;">' +
        '📁 <strong style="color:#aaa;">文件夹:</strong> ' + escapeHtml(model.folder) + '<br>' +
        '📄 <strong style="color:#aaa;">PMX文件:</strong> ' + escapeHtml(model.file) +
      '</div>' +

      '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button id="cancel-edit" style="flex:1;padding:10px;background:#333;color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:14px;">取消</button>' +
        '<button id="save-edit" style="flex:2;padding:10px;background:#1976d2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">保存修改</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  // 快捷图标按钮：写在这个弹窗自己的作用域里，不用 inline onclick + 全-document 查 id
  // （那会命中页面上第一个同名 id，重复 id 时把图标写进别的弹窗）。
  var iconBox = overlay.querySelector('#edit-icon-input');
  overlay.querySelectorAll('.edit-icon-preset').forEach(function (btn) {
    btn.addEventListener('click', function () { iconBox.value = this.textContent; });
  });

  // 绑定事件
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });

  var previewInput = overlay.querySelector('#edit-image-preview');
  var previewImg = overlay.querySelector('#preview-img');
  previewInput.addEventListener('input', function() {
    if (this.value) {
      previewImg.src = this.value;
      previewImg.style.display = 'block';
    } else {
      previewImg.style.display = 'none';
    }
  });

  overlay.querySelector('#cancel-edit').addEventListener('click', function() {
    overlay.remove();
  });

  overlay.querySelector('#save-edit').addEventListener('click', function() {
    var newName = overlay.querySelector('#edit-name').value.trim();
    if (!newName) { showToast('名称不能为空', 'error'); return; }

    // 曝光值:留空＝不改(保留库里原值,可能是 null);只有真填了才发。
    // 之前用 numOr(...,0.3) 把空/NaN 一律坐实成 0.3,管理员只改图标都会把 NULL 曝光写成 0.3。
    var expoRaw = overlay.querySelector('#edit-exposure').value.trim();
    var expoVal = expoRaw === '' ? undefined : parseFloat(expoRaw);

    // 排序与曝光同一口径:留空＝不改。原来 parseInt(...) || 0 会把清空当成"写 0",
    // 而 0 在 ORDER BY sort_order, id 里就是最前,管理员想"留空"反而把模型顶到第一位。
    var sortRaw = overlay.querySelector('#edit-sort').value.trim();
    var sortVal = sortRaw === '' ? undefined : parseInt(sortRaw, 10);

    var data = {
      name: newName,
      desc: overlay.querySelector('#edit-desc').value.trim(),
      source: overlay.querySelector('#edit-source').value,
      icon: overlay.querySelector('#edit-icon-input').value.trim() || '🎭',
      image_preview: overlay.querySelector('#edit-image-preview').value.trim(),
      exposure: expoVal,
      sort_order: sortVal
    };

    updateModelSetting(modelId, data);
    overlay.remove();
  });
}

function updateModelSetting(modelId, data) {
  apiCall(MODELS_API + '/admin/' + modelId, 'PUT', data).then(function (res) {
    if (res.success) {
      var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
      if (model) {
        if (data.name !== undefined) model.name = data.name;
        if (data.desc !== undefined) model.desc = data.desc;
        if (data.exposure !== undefined) model.exposure = data.exposure;
        if (data.sort_order !== undefined) model.sort_order = data.sort_order;
        if (data.source !== undefined) model.source = data.source;
        if (data.icon !== undefined) model.icon = data.icon;
        if (data.image_preview !== undefined) model.image_preview = data.image_preview;
      }
      if (data.sort_order !== undefined) State.models.sort(function (a, b) { return a.sort_order - b.sort_order; });
      renderModels();
      showToast('设置已更新', 'success');
    } else { showToast('保存失败: ' + res.message, 'error'); }
  }).catch(function (e) { showToast('保存失败: ' + e.message, 'error'); });
}

/* ── 删除模型 ── */
function deleteModel(modelId) {
  var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
  if (!model) return;
  var roleName = extractRoleName(model.name, model.desc);
  if (!confirm('确定要删除模型「' + roleName + '」吗?\n此操作仅删除数据库记录,不会删除磁盘上的模型文件.\n⚠️ 文件还在盘上 ⇒ 重启后扫描会把它当新模型重新入库.要下架请点「禁用」(禁用后连 .pmx 文件也下载不了).')) return;

  apiCall(MODELS_API + '/admin/' + modelId, 'DELETE').then(function (res) {
    if (res.success) {
      State.models = State.models.filter(function (m) { return String(m.id) !== String(modelId); });
      renderModels();
      var enabledCount = State.models.filter(function (m) { return m.enabled; }).length;
      document.getElementById('models-count').textContent = '共 ' + State.models.length + ' 个模型(已启用 ' + enabledCount + ' 个)';
      document.getElementById('stat-models').textContent = enabledCount + '/' + State.models.length;
      showToast('模型已删除', 'success');
    } else { showToast('删除失败: ' + res.message, 'error'); }
  }).catch(function (e) { showToast('删除失败: ' + e.message, 'error'); });
}
