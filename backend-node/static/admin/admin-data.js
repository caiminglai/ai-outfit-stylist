/* ══════════════════════════════════════════════════════════════
   管理后台 — 数据浏览/表结构/函数逻辑/源代码/API路由 模块

   功能：数据库表结构展示、数据浏览（分页）、函数逻辑浏览、
         源代码查看、API路由列表
   依赖: admin-utils.js（State, fetchJSON, escapeHtml, API_BASE, tableLabel）
   ══════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════
   数据库表结构
   ════════════════════════════════════ */
function loadTables() {
  var container = document.getElementById('tables-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  fetchJSON(API_BASE + '/tables').then(function(res) {
    if (!res.success) throw new Error(res.message);
    State.tables = res.data;
    renderTables(res.data);
    renderSidebarTables(res.data);
    renderTableSelect(res.data);
  }).catch(function(e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderTables(tables) {
  var container = document.getElementById('tables-container');
  container.className = '';
  container.innerHTML = '';

  tables.forEach(function(table) {
    var div = document.createElement('div');
    div.className = 'table-info card';

    var header = document.createElement('div');
    header.className = 'table-info-header';
    var cnLabel = TABLE_LABELS[table.table_name] || '';
    var displayName = cnLabel ? cnLabel + ' (' + escapeHtml(table.table_name) + ')' : escapeHtml(table.table_name);
    header.innerHTML = '<h3>📊 ' + displayName +
      ' <span style="color:var(--muted);font-size:11px">[' + escapeHtml(table.class_name) + ']</span></h3>' +
      '<span class="badge badge-null" style="margin-left:10px;">' + (table.row_count >= 0 ? table.row_count + ' 行' : '未知') + '</span>';
    div.appendChild(header);

    if (table.docstring) {
      var doc = document.createElement('div');
      doc.style.cssText = 'font-size:11px;color:var(--muted);margin-bottom:10px;padding:4px 10px;background:var(--bg);border-radius:4px;border-left:2px solid var(--accent);';
      doc.textContent = table.docstring;
      div.appendChild(doc);
    }

    var tbl = document.createElement('table');
    tbl.className = 'cols-table';
    tbl.innerHTML = '<thead><tr><th>列名</th><th>类型</th><th>可空</th><th>键</th><th>外键关联</th><th>中文注释</th></tr></thead><tbody>' +
      table.columns.map(function(col) {
        var badges = [];
        if (col.primary_key) badges.push('<span class="badge badge-pk">主键</span>');
        if (col.foreign_key) badges.push('<span class="badge badge-fk">外键</span>');
        var nullBadge = col.nullable ? '<span class="badge badge-null">可空</span>' : '<span class="badge badge-notnull">非空</span>';
        // 中文列名：优先从 COLUMN_COMMENTS 获取
        var cnComment = getColumnComment(table.table_name, col.name);
        var colDisplay = escapeHtml(col.name);
        if (cnComment) {
          colDisplay = '<span style="color:var(--accent)">' + escapeHtml(cnComment) + '</span> <span style="color:var(--muted);font-size:11px">(' + escapeHtml(col.name) + ')</span>';
        }
        return '<tr>' +
          '<td class="col-name">' + colDisplay + '</td>' +
          '<td class="col-type">' + escapeHtml(col.type) + '</td>' +
          '<td>' + nullBadge + '</td>' +
          '<td>' + badges.join(' ') + '</td>' +
          '<td style="font-size:11px;color:var(--purple)">' + (col.foreign_key ? escapeHtml(col.foreign_key) : '-') + '</td>' +
          '<td class="col-comment">' + escapeHtml(cnComment || col.comment || '') + '</td></tr>';
      }).join('') + '</tbody>';
    div.appendChild(tbl);

    if (table.relationships && table.relationships.length > 0) {
      var relDiv = document.createElement('div');
      relDiv.style.cssText = 'margin-top:10px;font-size:11px;color:var(--muted);';
      relDiv.innerHTML = '<strong style="color:var(--accent)">关联关系:</strong> ' +
        table.relationships.map(function(r) {
          return escapeHtml(r.name) + ' → ' + escapeHtml(r.target) + ' (' + (r.uselist ? '一对多' : '一对一') + ')';
        }).join('，');
      div.appendChild(relDiv);
    }
    container.appendChild(div);
  });
}

function renderSidebarTables(tables) {
  var sidebar = document.getElementById('sidebar-tables');
  sidebar.innerHTML = '';
  tables.forEach(function(table) {
    var item = document.createElement('div');
    item.className = 'sidebar-item';
    item.innerHTML = '<span>📊</span><span>' + escapeHtml(tableLabel(table.table_name)) + '</span>' +
      '<span class="count">' + (table.row_count >= 0 ? table.row_count : '?') + '</span>';
    item.addEventListener('click', function() {
      switchSection('data');
      document.getElementById('data-table-select').value = table.table_name;
      State.currentTable = table.table_name;
      State.currentPage = 1;
      loadTableData();
    });
    sidebar.appendChild(item);
  });
}

function renderTableSelect(tables) {
  var select = document.getElementById('data-table-select');
  select.innerHTML = '<option value="">-- 选择表 --</option>';
  tables.forEach(function(table) {
    var opt = document.createElement('option');
    opt.value = table.table_name;
    opt.textContent = tableLabel(table.table_name) + ' [' + table.class_name + ']';
    select.appendChild(opt);
  });
}

/* ════════════════════════════════════
   数据浏览
   ════════════════════════════════════ */
document.getElementById('data-table-select').addEventListener('change', function() {
  State.currentTable = this.value;
  State.currentPage = 1;
  if (State.currentTable) loadTableData();
});
document.getElementById('data-per-page').addEventListener('change', function() {
  State.perPage = parseInt(this.value);
  State.currentPage = 1;
  if (State.currentTable) loadTableData();
});
document.getElementById('data-refresh').addEventListener('click', function() {
  if (State.currentTable) loadTableData();
});

function loadTableData() {
  var container = document.getElementById('data-container');
  var pagination = document.getElementById('data-pagination');

  if (!State.currentTable) {
    container.className = 'loading'; container.textContent = '请选择表查看数据';
    pagination.style.display = 'none'; return;
  }

  container.className = 'loading'; container.textContent = '加载中...';
  pagination.style.display = 'none';

  var url = API_BASE + '/data/' + State.currentTable + '?page=' + State.currentPage + '&per_page=' + State.perPage;

  fetchJSON(url).then(function(res) {
    if (!res.success) throw new Error(res.message);
    renderTableData(res.data);
  }).catch(function(e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderTableData(data) {
  var container = document.getElementById('data-container');
  var pagination = document.getElementById('data-pagination');
  container.className = '';

  // 空表时用 schema 表头展示
  if (!data.rows || data.rows.length === 0) {
    var schemaCols = [];
    // 从 State.tables 找到当前表的列定义
    if (State.tables && State.tables.length > 0) {
      var tableInfo = State.tables.find(function(t) { return t.table_name === State.currentTable; });
      if (tableInfo && tableInfo.columns) {
        schemaCols = tableInfo.columns.map(function(c) { return c.name; });
      }
    }
    if (schemaCols.length === 0) {
      container.innerHTML = '<div class="card" style="text-align:center;color:var(--muted)">暂无数据</div>';
      pagination.style.display = 'none'; return;
    }
    var emptyHtml = '<div class="card" style="padding:0;overflow:auto;">';
    emptyHtml += '<table class="data-table"><thead><tr>';
    schemaCols.forEach(function(c) {
      var cn = getColumnComment(State.currentTable, c);
      var th = cn ? '<span style="color:var(--accent)">' + escapeHtml(cn) + '</span><br><span style="color:var(--muted);font-size:10px">' + escapeHtml(c) + '</span>' : escapeHtml(c);
      emptyHtml += '<th>' + th + '</th>';
    });
    emptyHtml += '</tr></thead><tbody><tr><td colspan="' + schemaCols.length + '" style="text-align:center;color:var(--muted);padding:20px;">暂无数据</td></tr></tbody></table></div>';
    container.innerHTML = emptyHtml;
    pagination.style.display = 'none'; return;
  }

  var cols = Object.keys(data.rows[0]);
  var html = '<div class="card" style="padding:0;overflow:auto;">';
  html += '<table class="data-table"><thead><tr>';
  cols.forEach(function(c) {
    var cn = getColumnComment(State.currentTable, c);
    var th = cn ? '<span style="color:var(--accent)">' + escapeHtml(cn) + '</span><br><span style="color:var(--muted);font-size:10px">' + escapeHtml(c) + '</span>' : escapeHtml(c);
    html += '<th>' + th + '</th>';
  });
  html += '</tr></thead><tbody>';
  data.rows.forEach(function(row) {
    html += '<tr>';
    cols.forEach(function(c) {
      var rawVal = row[c];
      var val = rawVal;
      if (val === null || val === undefined) {
        val = '<span style="color:var(--muted)">空</span>';
      } else if (typeof val === 'object') {
        val = '<span style="color:var(--purple)">' + escapeHtml(JSON.stringify(val).slice(0, 80)) + '...</span>';
      } else {
        // 翻译英文枚举值为中文
        var translated = translateValue(State.currentTable, c, val);
        if (translated !== val) {
          // 有翻译：显示中文 + 小字英文原文
          val = '<span style="color:var(--accent)">' + escapeHtml(translated) + '</span>' +
                '<span style="color:var(--muted);font-size:10px"> (' + escapeHtml(val) + ')</span>';
        } else if (State.currentTable === 'rule_conditions' && c === 'value') {
          // 规则条件值：解析 JSON 并格式化显示
          try {
            var parsed = JSON.parse(val);
            var parts = [];
            Object.keys(parsed).forEach(function(k) {
              var fieldLabel = (VALUE_LABELS['rule_conditions.field'] || {})[k] || k;
              parts.push(fieldLabel + '=' + parsed[k]);
            });
            val = '<span style="color:var(--accent)">' + escapeHtml(parts.join('，')) + '</span>';
          } catch(e) {
            val = escapeHtml(val);
          }
        } else {
          val = escapeHtml(val);
        }
      }
      html += '<td title="' + escapeHtml(JSON.stringify(rawVal)) + '">' + val + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;

  pagination.style.display = 'flex'; pagination.innerHTML = '';
  var prevBtn = document.createElement('button');
  prevBtn.textContent = '上一页'; prevBtn.disabled = data.page <= 1;
  prevBtn.addEventListener('click', function() { State.currentPage--; loadTableData(); });
  pagination.appendChild(prevBtn);

  var info = document.createElement('span');
  info.textContent = '第 ' + data.page + ' / ' + data.total_pages + ' 页 · 共 ' + data.total + ' 条';
  pagination.appendChild(info);

  var nextBtn = document.createElement('button');
  nextBtn.textContent = '下一页'; nextBtn.disabled = data.page >= data.total_pages;
  nextBtn.addEventListener('click', function() { State.currentPage++; loadTableData(); });
  pagination.appendChild(nextBtn);
}

/* ════════════════════════════════════
   函数逻辑
   ════════════════════════════════════ */
function loadFunctions() {
  var container = document.getElementById('functions-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  fetchJSON(API_BASE + '/functions').then(function(res) {
    if (!res.success) throw new Error(res.message);
    State.functions = res.data;
    renderFunctions(res.data);
    renderSidebarModules(res.data);
    renderSourceSelect(res.data);
  }).catch(function(e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderFunctions(modules) {
  var container = document.getElementById('functions-container');
  container.className = '';
  container.innerHTML = '';

  modules.forEach(function(mod) {
    var card = document.createElement('div');
    card.className = 'module-card';

    var header = document.createElement('div');
    header.className = 'module-header';
    header.innerHTML = '<span class="arrow">▶</span>' +
      '<span class="name">' + escapeHtml(mod.label) + '</span>' +
      '<span class="file">' + escapeHtml(mod.file) + '</span>';

    var body = document.createElement('div');
    body.className = 'module-body';

    if (mod.error) {
      body.innerHTML = '<div class="error-msg">' + escapeHtml(mod.error) + '</div>';
    } else {
      var html = '';
      if (mod.classes && mod.classes.length > 0) {
        html += '<h3 style="margin-top:0">类定义 (' + mod.classes.length + ')</h3>';
        mod.classes.forEach(function(cls) {
          html += '<div class="class-block">';
          html += '<div class="class-name">class ' + escapeHtml(cls.name) + '</div>';
          if (cls.docstring) html += '<div class="func-doc">' + escapeHtml(cls.docstring) + '</div>';
          if (cls.methods && cls.methods.length > 0) {
            html += '<div style="padding-left:16px;">';
            cls.methods.forEach(function(m) {
              html += '<div class="func-item">';
              html += '<div class="func-sig"><span class="fname">' + escapeHtml(m.name) + '</span>' + escapeHtml(m.signature.replace(m.name, '')) + '</div>';
              if (m.docstring) html += '<div class="func-doc">' + escapeHtml(m.docstring) + '</div>';
              html += '</div>';
            });
            html += '</div>';
          }
          html += '</div>';
        });
      }
      if (mod.functions && mod.functions.length > 0) {
        html += '<h3>函数 (' + mod.functions.length + ')</h3>';
        mod.functions.forEach(function(f) {
          html += '<div class="func-item">';
          html += '<div class="func-sig"><span class="fname">' + escapeHtml(f.name) + '</span>' + escapeHtml(f.signature.replace(f.name, '')) + '</div>';
          if (f.docstring) html += '<div class="func-doc">' + escapeHtml(f.docstring) + '</div>';
          html += '</div>';
        });
      }
      if (!mod.classes.length && !mod.functions.length) {
        html += '<div style="color:var(--muted);font-size:12px;">无公开函数或类</div>';
      }
      body.innerHTML = html;
    }

    header.addEventListener('click', function() {
      header.classList.toggle('open');
      body.classList.toggle('open');
    });
    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  });
}

function renderSidebarModules(modules) {
  var sidebar = document.getElementById('sidebar-modules');
  sidebar.innerHTML = '';
  modules.forEach(function(mod) {
    var item = document.createElement('div');
    item.className = 'sidebar-item';
    var funcCount = (mod.functions ? mod.functions.length : 0) + (mod.classes ? mod.classes.length : 0);
    item.innerHTML = '<span>📄</span><span>' + escapeHtml(mod.label.split(' ')[0]) + '</span><span class="count">' + funcCount + '</span>';
    item.addEventListener('click', function() {
      switchSection('source');
      document.getElementById('source-file-select').value = mod.file;
      loadSource(mod.file);
    });
    sidebar.appendChild(item);
  });
}

/* ════════════════════════════════════
   源代码查看
   ════════════════════════════════════ */
function renderSourceSelect(modules) {
  var select = document.getElementById('source-file-select');
  select.innerHTML = '';
  modules.forEach(function(mod) {
    var opt = document.createElement('option');
    opt.value = mod.file;
    opt.textContent = mod.label;
    select.appendChild(opt);
  });
}

document.getElementById('source-load').addEventListener('click', function() {
  var file = document.getElementById('source-file-select').value;
  if (file) loadSource(file);
});

function loadSource(file) {
  var pre = document.getElementById('source-content');
  pre.textContent = '加载中...';

  fetchJSON(API_BASE + '/source/' + file).then(function(res) {
    if (!res.success) throw new Error(res.message);
    pre.textContent = res.data.content;
  }).catch(function(e) { pre.textContent = '加载失败: ' + e.message; });
}

/* ════════════════════════════════════
   API 路由列表
   ════════════════════════════════════ */
function loadRoutes() {
  var container = document.getElementById('routes-container');
  container.className = 'loading';
  container.textContent = '加载中...';

  fetchJSON(API_BASE + '/routes').then(function(res) {
    if (!res.success) throw new Error(res.message);
    renderRoutes(res.data);
  }).catch(function(e) {
    container.className = '';
    container.innerHTML = '<div class="error-msg">加载失败: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderRoutes(routes) {
  var container = document.getElementById('routes-container');
  container.className = '';
  container.innerHTML = '';

  var card = document.createElement('div');
  card.className = 'card';
  card.style.padding = '0';

  var html = '<table class="route-table"><thead><tr><th>路由规则</th><th>端点</th><th>请求方法</th></tr></thead><tbody>';
  routes.forEach(function(r) {
    var methods = r.methods.map(function(m) {
      return '<span class="badge badge-method">' + m + '</span>';
    }).join(' ');
    html += '<tr><td class="route-rule">' + escapeHtml(r.rule) + '</td>' +
      '<td style="font-size:11px;color:var(--muted)">' + escapeHtml(r.endpoint) + '</td>' +
      '<td>' + methods + '</td></tr>';
  });
  html += '</tbody></table>';
  card.innerHTML = html;
  container.appendChild(card);
}
