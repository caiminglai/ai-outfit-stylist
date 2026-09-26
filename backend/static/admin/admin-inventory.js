/* ══════════════════════════════════════════════════════════════
   管理后台 — 库存管理模块

   功能：商品列表/筛选/新增/编辑/删除/分类管理
   依赖: admin-utils.js（State, fetchJSON, apiCall, escapeHtml, showToast, INV_API）
   ══════════════════════════════════════════════════════════════ */

/* ── 事件绑定 ── */
document.getElementById('inv-create-btn').addEventListener('click', function() { openProductModal(null); });
document.getElementById('inv-category-btn').addEventListener('click', openCategoryModal);
document.getElementById('inv-refresh').addEventListener('click', loadInventory);
document.getElementById('inv-filter-category').addEventListener('change', loadInventory);
document.getElementById('inv-filter-stock').addEventListener('change', loadInventory);
document.getElementById('inv-search').addEventListener('input', function() {
  clearTimeout(window._invSearchTimer);
  window._invSearchTimer = setTimeout(loadInventory, 300);
});

/* ── 加载分类 ── */
function loadCategories() {
  return fetchJSON(INV_API + '/categories').then(function(res) {
    if (res.success) {
      State.categories = res.data;
      var filter = document.getElementById('inv-filter-category');
      filter.innerHTML = '<option value="">全部分类</option>';
      res.data.forEach(function(c) {
        filter.innerHTML += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      });
    }
  });
}

/* ── 加载库存列表 ── */
function loadInventory() {
  var container = document.getElementById('inv-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  var params = [];
  var cat = document.getElementById('inv-filter-category').value;
  var stock = document.getElementById('inv-filter-stock').value;
  if (cat) params.push('category_id=' + cat);
  if (stock === 'in') params.push('in_stock=true');
  if (stock === 'out') params.push('in_stock=false');

  var url = INV_API + '/products' + (params.length ? '?' + params.join('&') : '');

  fetchJSON(url).then(function(res) {
    if (!res.success) throw new Error(res.message);
    var search = document.getElementById('inv-search').value.trim().toLowerCase();
    var products = res.data;
    if (search) {
      products = products.filter(function(p) {
        return (p.name || '').toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search);
      });
    }
    State.products = products;
    renderInventory(products);
    document.getElementById('inv-count').textContent = '共 ' + products.length + ' 件商品';
  }).catch(function(e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ── 渲染库存卡片 ── */
function renderInventory(products) {
  var container = document.getElementById('inv-container');
  container.className = '';

  if (!products || products.length === 0) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--muted);">暂无库存商品，点击「新增商品」添加</div>';
    return;
  }

  var grouped = {};
  products.forEach(function(p) {
    var catName = '未分类';
    if (p.category_id) {
      var cat = State.categories.find(function(c) { return c.id === p.category_id; });
      if (cat) catName = cat.name;
    }
    if (!grouped[catName]) grouped[catName] = [];
    grouped[catName].push(p);
  });

  container.innerHTML = '';
  Object.keys(grouped).forEach(function(catName) {
    var section = document.createElement('div');
    section.innerHTML = '<h3 style="color:var(--accent);margin-bottom:10px;">' + escapeHtml(catName) + ' (' + grouped[catName].length + ')</h3>';

    grouped[catName].forEach(function(p) {
      var card = document.createElement('div');
      card.className = 'inv-product-card' + (p.stock <= 0 ? ' out-of-stock' : '');

      var stockBadge = '';
      if (p.stock <= 0) stockBadge = '<span class="stock-badge stock-out">缺货</span>';
      else if (p.stock <= 5) stockBadge = '<span class="stock-badge stock-low">库存' + p.stock + '</span>';
      else stockBadge = '<span class="stock-badge stock-in">库存' + p.stock + '</span>';

      var tagsHtml = '';
      (p.style_tags || []).forEach(function(t) { tagsHtml += '<span class="tag tag-style">' + escapeHtml(t) + '</span>'; });
      (p.color_tags || []).forEach(function(t) { tagsHtml += '<span class="tag tag-color">' + escapeHtml(t) + '</span>'; });
      (p.fit_skin_tones || []).forEach(function(t) { tagsHtml += '<span class="tag tag-skin">' + escapeHtml(t) + '</span>'; });
      (p.fit_face_shapes || []).forEach(function(t) { tagsHtml += '<span class="tag tag-face">' + escapeHtml(t) + '</span>'; });

      card.innerHTML =
        '<div class="inv-product-info">' +
          '<div class="inv-product-name">' + escapeHtml(p.name) + ' ' + stockBadge + '</div>' +
          '<div class="inv-product-meta">' +
            (p.sku ? '<span style="font-size:11px;color:var(--muted);">SKU: ' + escapeHtml(p.sku) + '</span>' : '') +
            (p.price != null ? '<span style="font-size:11px;color:var(--orange);">¥' + p.price + '</span>' : '') +
          '</div>' +
          (tagsHtml ? '<div class="inv-product-tags">' + tagsHtml + '</div>' : '') +
          (p.description ? '<div style="font-size:11px;color:var(--muted);margin-top:4px;">' + escapeHtml(p.description) + '</div>' : '') +
        '</div>' +
        '<div class="inv-actions">' +
          '<button class="btn btn-sm" onclick="openProductModal(' + p.id + ')">✏️</button>' +
          '<button class="btn btn-sm btn-red" onclick="deleteProduct(' + p.id + ')">🗑</button>' +
        '</div>';

      section.appendChild(card);
    });
    container.appendChild(section);
  });
}

/* ── 商品编辑模态框 ── */
function openProductModal(productId) {
  State.editingProductId = productId;
  var title = document.getElementById('product-modal-title');
  var body = document.getElementById('product-modal-body');

  var p = null;
  if (productId) {
    p = State.products.find(function(item) { return item.id === productId; });
    if (!p) return;
    title.textContent = '编辑商品 #' + productId;
  } else {
    title.textContent = '新增商品';
  }

  var catOptions = State.categories.map(function(c) {
    return '<option value="' + c.id + '"' + (p && p.category_id === c.id ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
  }).join('');

  body.innerHTML =
    '<div class="form-row">' +
    '<div class="form-group"><label>商品名称 <span class="req">*</span></label><input type="text" id="pf-name" value="' + escapeHtml(p ? p.name : '') + '"></div>' +
    '<div class="form-group"><label>SKU编号</label><input type="text" id="pf-sku" value="' + escapeHtml(p ? (p.sku || '') : '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>分类 <span class="req">*</span></label><select id="pf-category">' + catOptions + '</select></div>' +
    '<div class="form-group"><label>库存数量</label><input type="number" id="pf-stock" value="' + (p ? (p.stock || 0) : 0) + '"></div>' +
    '<div class="form-group"><label>价格 (¥)</label><input type="number" id="pf-price" value="' + (p ? (p.price || '') : '') + '" step="0.01"></div>' +
    '</div>' +
    '<div class="form-group"><label>风格标签 (逗号分隔)</label><input type="text" id="pf-style" value="' + escapeHtml((p && p.style_tags) ? p.style_tags.join(', ') : '') + '" placeholder="通勤, 简约, 正式"></div>' +
    '<div class="form-group"><label>颜色标签 (逗号分隔)</label><input type="text" id="pf-color" value="' + escapeHtml((p && p.color_tags) ? p.color_tags.join(', ') : '') + '" placeholder="白色, 蓝色"></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>适合肤色 (逗号分隔)</label><input type="text" id="pf-skin" value="' + escapeHtml((p && p.fit_skin_tones) ? p.fit_skin_tones.join(', ') : '') + '" placeholder="暖皮, 冷皮"></div>' +
    '<div class="form-group"><label>适合脸型 (逗号分隔)</label><input type="text" id="pf-face" value="' + escapeHtml((p && p.fit_face_shapes) ? p.fit_face_shapes.join(', ') : '') + '" placeholder="圆脸, 方脸"></div>' +
    '</div>' +
    '<div class="form-group"><label>商品图片URL</label><input type="text" id="pf-image" value="' + escapeHtml(p ? (p.image_url || '') : '') + '"></div>' +
    '<div class="form-group"><label>商品描述</label><textarea id="pf-desc">' + escapeHtml(p ? (p.description || '') : '') + '</textarea></div>' +
    '<div class="form-group"><label><input type="checkbox" id="pf-enabled"' + (!p || p.enabled !== false ? ' checked' : '') + '> 上架销售</label></div>';

  document.getElementById('product-modal').classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  State.editingProductId = null;
}

/* ── 保存商品 ── */
document.getElementById('product-save-btn').addEventListener('click', function() {
  var name = document.getElementById('pf-name').value.trim();
  var categoryId = document.getElementById('pf-category').value;
  if (!name) { showToast('商品名称不能为空', 'error'); return; }
  if (!categoryId) { showToast('请选择分类', 'error'); return; }

  function parseTags(str) { return str.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; }); }

  var data = {
    name: name,
    category_id: parseInt(categoryId),
    sku: document.getElementById('pf-sku').value.trim() || null,
    stock: parseInt(document.getElementById('pf-stock').value) || 0,
    price: document.getElementById('pf-price').value ? parseFloat(document.getElementById('pf-price').value) : null,
    style_tags: parseTags(document.getElementById('pf-style').value),
    color_tags: parseTags(document.getElementById('pf-color').value),
    fit_skin_tones: parseTags(document.getElementById('pf-skin').value),
    fit_face_shapes: parseTags(document.getElementById('pf-face').value),
    image_url: document.getElementById('pf-image').value.trim() || null,
    description: document.getElementById('pf-desc').value.trim() || null,
    enabled: document.getElementById('pf-enabled').checked,
  };

  var method = State.editingProductId ? 'PUT' : 'POST';
  var url = State.editingProductId ? INV_API + '/products/' + State.editingProductId : INV_API + '/products';

  apiCall(url, method, data).then(function(res) {
    if (res.success) {
      showToast(State.editingProductId ? '商品更新成功' : '商品创建成功', 'success');
      closeProductModal(); loadInventory(); loadStats();
    } else { showToast('保存失败: ' + res.message, 'error'); }
  }).catch(function(e) { showToast('保存失败: ' + e.message, 'error'); });
});

function deleteProduct(productId) {
  if (!confirm('确定删除此商品？')) return;
  apiCall(INV_API + '/products/' + productId, 'DELETE').then(function(res) {
    if (res.success) { showToast('商品已删除', 'success'); loadInventory(); loadStats(); }
    else { showToast('删除失败: ' + res.message, 'error'); }
  });
}

/* ── 分类管理 ── */
function openCategoryModal() {
  loadCategoryList();
  document.getElementById('category-modal').classList.add('open');
}

function closeCategoryModal() {
  document.getElementById('category-modal').classList.remove('open');
}

function loadCategoryList() {
  var body = document.getElementById('category-modal-body');
  body.innerHTML = '<div class="loading">加载中...</div>';

  fetchJSON(INV_API + '/categories').then(function(res) {
    if (!res.success) throw new Error(res.message);
    var html = '<div id="cat-list">';
    res.data.forEach(function(c) {
      html += '<div class="condition-row" style="margin-bottom:6px;" data-cat-id="' + c.id + '">' +
        '<input type="text" class="cat-name" value="' + escapeHtml(c.name) + '" style="flex:1;" placeholder="分类名称">' +
        '<input type="text" class="cat-code" value="' + escapeHtml(c.code) + '" style="flex:0 0 100px;" placeholder="代码">' +
        '<input type="number" class="cat-sort" value="' + (c.sort_order || 0) + '" style="flex:0 0 60px;" placeholder="排序">' +
        '<button class="btn btn-sm btn-green" onclick="updateCategory(' + c.id + ', this)">保存</button>' +
        '<button class="btn btn-sm btn-red" onclick="deleteCategory(' + c.id + ')">删除</button>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="rule-section-label" style="margin-top:16px;">新增分类</div>';
    html += '<div class="condition-row">' +
      '<input type="text" id="new-cat-name" style="flex:1;" placeholder="分类名称">' +
      '<input type="text" id="new-cat-code" style="flex:0 0 100px;" placeholder="代码">' +
      '<input type="number" id="new-cat-sort" value="0" style="flex:0 0 60px;" placeholder="排序">' +
      '<button class="btn btn-sm btn-primary" onclick="createCategory()">+ 添加</button>' +
      '</div>';
    body.innerHTML = html;
  }).catch(function(e) {
    body.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function createCategory() {
  var name = document.getElementById('new-cat-name').value.trim();
  var code = document.getElementById('new-cat-code').value.trim();
  var sort = parseInt(document.getElementById('new-cat-sort').value) || 0;
  if (!name || !code) { showToast('名称和代码不能为空', 'error'); return; }

  apiCall(INV_API + '/categories', 'POST', { name: name, code: code, sort_order: sort }).then(function(res) {
    if (res.success) { showToast('分类创建成功', 'success'); loadCategoryList(); loadCategories(); loadStats(); }
    else { showToast('创建失败: ' + res.message, 'error'); }
  });
}

function updateCategory(catId, btn) {
  var row = btn.closest('.condition-row');
  var name = row.querySelector('.cat-name').value.trim();
  var code = row.querySelector('.cat-code').value.trim();
  var sort = parseInt(row.querySelector('.cat-sort').value) || 0;

  apiCall(INV_API + '/categories/' + catId, 'PUT', { name: name, code: code, sort_order: sort }).then(function(res) {
    if (res.success) { showToast('分类更新成功', 'success'); loadCategories(); }
    else { showToast('更新失败: ' + res.message, 'error'); }
  });
}

function deleteCategory(catId) {
  if (!confirm('确定删除此分类？需先清空该分类下的商品。')) return;
  apiCall(INV_API + '/categories/' + catId, 'DELETE').then(function(res) {
    if (res.success) { showToast('分类已删除', 'success'); loadCategoryList(); loadCategories(); loadStats(); }
    else { showToast('删除失败: ' + res.message, 'error'); }
  });
}
