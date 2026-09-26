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
    State.models = res.data;
    renderModels();
    var total = res.data.length;
    var enabledCount = res.data.filter(function (m) { return m.enabled; }).length;
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
function enableAllModels() {
  if (!confirm('确定要启用全部模型吗?')) return;
  var pending = State.models.filter(function (m) { return !m.enabled; });
  if (pending.length === 0) { showToast('所有模型已启用', 'success'); return; }

  var completed = 0, failed = 0;
  pending.forEach(function (m) {
    apiCall(MODELS_API + '/admin/' + m.id + '/toggle', 'POST').then(function (res) {
      if (res.success) { m.enabled = true; completed++; } else { failed++; }
    }).catch(function () { failed++; }).finally(function () {
      if (completed + failed === pending.length) {
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

  var grouped = {};
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

      // 渲染参数摘要(只读展示,编辑请点"编辑"按钮)
      var paramSummary =
        '<div class="model-params-summary">' +
          '<span title="缩放">🔍 ' + (m.scale ?? 1.0) + '</span>' +
          '<span title="相机距离">📷 ' + (m.camera_distance ?? 5.0) + '</span>' +
          '<span title="环境光">💡 ' + (m.ambient_light ?? 0.6) + '</span>' +
          '<span title="位置">📍 ' + (m.pos_x ?? 0) + ',' + (m.pos_y ?? 0) + ',' + (m.pos_z ?? 0) + '</span>' +
          '<span title="旋转">🔄 ' + (m.rot_x ?? 0) + '°,' + (m.rot_y ?? 0) + '°,' + (m.rot_z ?? 0) + '°</span>' +
        '</div>';

      // 卡片布局: 左侧图标 + 中间信息 + 右侧操作
      card.innerHTML =
        '<div class="model-card-left">' +
          displayContent +
        '</div>' +
        '<div class="model-card-center">' +
          '<div class="model-card-name">' + escapeHtml(roleName) + ' ' + statusBadge + '</div>' +
          '<div class="model-card-desc">' + (descText ? escapeHtml(descText) : '<span style="opacity:0.4;">无描述</span>') + '</div>' +
          paramSummary +
        '</div>' +
        '<div class="model-card-right">' +
          '<div class="model-quick-controls">' +
            '<label>曝光<input type="number" class="model-exposure" data-id="' + m.id + '" value="' + m.exposure + '" step="0.1" min="0.1" max="5"></label>' +
            '<label>排序<input type="number" class="model-sort" data-id="' + m.id + '" value="' + m.sort_order + '" style="width:50px;"></label>' +
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
  document.querySelectorAll('.model-exposure').forEach(function (input) {
    input.addEventListener('change', function () {
      updateModelSetting(this.dataset.id, { exposure: parseFloat(this.value) || 0.2 });
    });
  });
  document.querySelectorAll('.model-sort').forEach(function (input) {
    input.addEventListener('change', function () {
      updateModelSetting(this.dataset.id, { sort_order: parseInt(this.value) || 0 });
    });
  });
}

/* ── 启用/禁用模型 ── */
function toggleModel(modelId) {
  apiCall(MODELS_API + '/admin/' + modelId + '/toggle', 'POST').then(function (res) {
    if (res.success) {
      var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
      if (model) model.enabled = res.data.enabled;
      renderModels();
      var enabledCount = State.models.filter(function (m) { return m.enabled; }).length;
      document.getElementById('models-count').textContent = '共 ' + State.models.length + ' 个模型(已启用 ' + enabledCount + ' 个)';
      document.getElementById('stat-models').textContent = enabledCount + '/' + State.models.length;
      showToast(res.message, 'success');
    } else { showToast('操作失败: ' + res.message, 'error'); }
  }).catch(function (e) { showToast('操作失败: ' + e.message, 'error'); });
}

/* ── 编辑模型(完整表单弹窗) ── */
function editModelName(modelId) {
  var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
  if (!model) return;

  // 创建弹窗遮罩和内容
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  
  var sourceOptions = ['原神','鸣潮','尘白禁区','崩坏：星穹铁道','崩坏3','深空之眼','幻塔','世界计划','VOCALOID','MMD','战双帕弥什','其他'];
  var sourceSelect = sourceOptions.map(function(s) {
    return '<option value="' + s + '"' + (model.source === s ? ' selected' : '') + '>' + s + '</option>';
  }).join('');

  var iconPresets = ['🎭','⚔️','🎵','🌸','⚡','🔥','❄️','🌙','⭐','💎','🎨','🌟','💫','🎪'];
  var iconButtons = iconPresets.map(function(ic) {
    return '<button type="button" onclick="document.getElementById(\'edit-icon-input\').value=this.textContent" style="padding:4px 8px;margin:2px;border:1px solid #444;background:#222;color:#fff;border-radius:4px;cursor:pointer;font-size:16px;">' + ic + '</button>';
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
          '<input id="edit-exposure" type="number" value="' + model.exposure + '" step="0.1" min="0.1" max="5" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="display:block;font-size:13px;color:#aaa;margin-bottom:4px;">🔢 排序</label>' +
          '<input id="edit-sort" type="number" value="' + model.sort_order + '" style="width:100%;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box;">' +
        '</div>' +
      '</div>' +

      // 渲染参数(缩放/位置/旋转/相机/环境光)
      '<details style="margin-bottom:14px;">' +
        '<summary style="cursor:pointer;font-size:13px;color:#4fc3f7;padding:6px 0;">🎛️ 高级渲染参数</summary>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px;background:#161616;border-radius:6px;margin-top:6px;">' +
          '<label>缩放:<input id="edit-scale" type="number" value="' + (model.scale !== undefined ? model.scale : 1) + '" step="0.1" min="0.1" max="5" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>相机距离:<input id="edit-camera" type="number" value="' + (model.camera_distance !== undefined ? model.camera_distance : 5) + '" step="0.5" min="1" max="50" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>环境光:<input id="edit-ambient" type="number" value="' + (model.ambient_light !== undefined ? model.ambient_light : 0.6) + '" step="0.1" min="0" max="3" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>位置X:<input id="edit-pos-x" type="number" value="' + (model.pos_x !== undefined ? model.pos_x : 0) + '" step="0.1" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>位置Y:<input id="edit-pos-y" type="number" value="' + (model.pos_y !== undefined ? model.pos_y : 0) + '" step="0.1" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>位置Z:<input id="edit-pos-z" type="number" value="' + (model.pos_z !== undefined ? model.pos_z : 0) + '" step="0.1" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>旋转X°:<input id="edit-rot-x" type="number" value="' + (model.rot_x !== undefined ? model.rot_x : 0) + '" step="5" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>旋转Y°:<input id="edit-rot-y" type="number" value="' + (model.rot_y !== undefined ? model.rot_y : 0) + '" step="5" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
          '<label>旋转Z°:<input id="edit-rot-z" type="number" value="' + (model.rot_z !== undefined ? model.rot_z : 0) + '" step="5" style="width:100%;padding:6px;background:#222;border:1px solid #444;border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box;"></label>' +
        '</div>' +
      '</details>' +

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

    var numOr = function(id, def) {
      var v = parseFloat(overlay.querySelector(id).value);
      return isNaN(v) ? def : v;
    };

    var data = {
      name: newName,
      desc: overlay.querySelector('#edit-desc').value.trim(),
      source: overlay.querySelector('#edit-source').value,
      icon: overlay.querySelector('#edit-icon-input').value.trim() || '🎭',
      image_preview: overlay.querySelector('#edit-image-preview').value.trim(),
      exposure: numOr('#edit-exposure', 0.3),
      sort_order: parseInt(overlay.querySelector('#edit-sort').value) || 0,
      scale: numOr('#edit-scale', 1.0),
      camera_distance: numOr('#edit-camera', 5.0),
      ambient_light: numOr('#edit-ambient', 0.6),
      pos_x: numOr('#edit-pos-x', 0),
      pos_y: numOr('#edit-pos-y', 0),
      pos_z: numOr('#edit-pos-z', 0),
      rot_x: numOr('#edit-rot-x', 0),
      rot_y: numOr('#edit-rot-y', 0),
      rot_z: numOr('#edit-rot-z', 0)
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
        // 渲染参数同步到本地 State
        ['scale','pos_x','pos_y','pos_z','rot_x','rot_y','rot_z','camera_distance','ambient_light'].forEach(function(k){
          if (data[k] !== undefined) model[k] = data[k];
        });
      }
      if (data.sort_order !== undefined) State.models.sort(function (a, b) { return a.sort_order - b.sort_order; });
      // 只要包含非渲染参数字段(如 name/desc/source 等),就重新渲染列表
      var renderParamKeys = ['scale','pos_x','pos_y','pos_z','rot_x','rot_y','rot_z','camera_distance','ambient_light'];
      var hasNonRenderParam = Object.keys(data).some(function(k){
        return renderParamKeys.indexOf(k) < 0;
      });
      if (hasNonRenderParam) renderModels();
      showToast('设置已更新', 'success');
    } else { showToast('保存失败: ' + res.message, 'error'); }
  }).catch(function (e) { showToast('保存失败: ' + e.message, 'error'); });
}

/* ── 删除模型 ── */
function deleteModel(modelId) {
  var model = State.models.find(function (m) { return String(m.id) === String(modelId); });
  if (!model) return;
  var roleName = extractRoleName(model.name, model.desc);
  if (!confirm('确定要删除模型「' + roleName + '」吗?\n此操作仅删除数据库记录,不会删除磁盘上的模型文件.')) return;

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
