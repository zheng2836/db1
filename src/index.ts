import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

app.use('/api/*', cors());

// 获取所有表
app.get('/api/tables', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name != 'sqlite_sequence'`
  ).all();
  return c.json(result.results);
});

// 创建表
app.post('/api/tables', async (c) => {
  const { table_name, columns } = await c.req.json();
  
  if (!table_name || !columns || !Array.isArray(columns)) {
    return c.json({ error: 'Invalid input' }, 400);
  }

  const columnDefs = columns.map(col => {
    let def = `"${col.name}" ${col.type}`;
    if (col.primary_key) def += ' PRIMARY KEY';
    if (col.not_null) def += ' NOT NULL';
    if (col.default_value !== undefined) def += ` DEFAULT ${typeof col.default_value === 'string' ? `'${col.default_value}'` : col.default_value}`;
    return def;
  });

  const sql = `CREATE TABLE IF NOT EXISTS "${table_name}" (${columnDefs.join(', ')})`;
  
  try {
    await c.env.DB.prepare(sql).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 删除表
app.delete('/api/tables/:name', async (c) => {
  const tableName = c.req.param('name');
  try {
    await c.env.DB.prepare(`DROP TABLE IF EXISTS "${tableName}"`).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 获取表结构
app.get('/api/tables/:name/schema', async (c) => {
  const tableName = c.req.param('name');
  try {
    const result = await c.env.DB.prepare(`PRAGMA table_info("${tableName}")`).all();
    return c.json(result.results);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 添加列
app.post('/api/tables/:name/columns', async (c) => {
  const tableName = c.req.param('name');
  const { name, type, not_null, default_value } = await c.req.json();
  
  if (!name || !type) {
    return c.json({ error: 'Column name and type required' }, 400);
  }

  let alterSql = `ALTER TABLE "${tableName}" ADD COLUMN "${name}" ${type}`;
  if (not_null) alterSql += ' NOT NULL';
  if (default_value !== undefined) alterSql += ` DEFAULT ${typeof default_value === 'string' ? `'${default_value}'` : default_value}`;

  try {
    await c.env.DB.prepare(alterSql).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 删除列
app.delete('/api/tables/:name/columns/:column', async (c) => {
  const tableName = c.req.param('name');
  const columnName = c.req.param('column');

  try {
    const schemaResult = await c.env.DB.prepare(`PRAGMA table_info("${tableName}")`).all();
    const columns = schemaResult.results.map((col: any) => col.name);

    if (!columns.includes(columnName)) {
      return c.json({ error: 'Column does not exist' }, 404);
    }

    const keepColumns = columns.filter(col => col !== columnName);
    const tempTableName = `${tableName}_temp`;
    
    const schemaInfo = await c.env.DB.prepare(`PRAGMA table_info("${tableName}")`).all();
    const columnDefs = schemaInfo.results
      .filter((col: any) => keepColumns.includes(col.name))
      .map((col: any) => `"${col.name}" ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value !== null ? ` DEFAULT ${col.dflt_value}` : ''}`)
      .join(', ');

    await c.env.DB.prepare(`CREATE TABLE "${tempTableName}" (${columnDefs})`).run();
    await c.env.DB.prepare(`INSERT INTO "${tempTableName}" SELECT ${keepColumns.map(c => `"${c}"`).join(', ')} FROM "${tableName}"`).run();
    await c.env.DB.prepare(`DROP TABLE "${tableName}"`).run();
    await c.env.DB.prepare(`ALTER TABLE "${tempTableName}" RENAME TO "${tableName}"`).run();

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 查询行（分页）
app.get('/api/tables/:name/rows', async (c) => {
  const tableName = c.req.param('name');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = Math.min(parseInt(c.req.query('page_size') || '10'), 100);
  const offset = (page - 1) * pageSize;

  try {
    const countResult = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM "${tableName}"`).all();
    const total = (countResult.results[0] as any).total;

    const result = await c.env.DB.prepare(
      `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`
    ).bind(pageSize, offset).all();

    return c.json({
      data: result.results,
      pagination: {
        page,
        page_size: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      }
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 插入行
app.post('/api/tables/:name/rows', async (c) => {
  const tableName = c.req.param('name');
  const rowData = await c.req.json();

  if (typeof rowData !== 'object' || Array.isArray(rowData)) {
    return c.json({ error: 'Invalid row data' }, 400);
  }

  const columns = Object.keys(rowData);
  const values = Object.values(rowData);

  const placeholders = values.map(() => '?').join(', ');
  const sql = `INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')}) VALUES (${placeholders})`;

  try {
    await c.env.DB.prepare(sql).bind(...values).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 更新行
app.put('/api/tables/:name/rows', async (c) => {
  const tableName = c.req.param('name');
  const { where, data } = await c.req.json();

  if (typeof where !== 'object' || typeof data !== 'object') {
    return c.json({ error: 'Invalid where or data object' }, 400);
  }

  const whereCols = Object.keys(where);
  const whereVals = Object.values(where);
  const dataCols = Object.keys(data);
  const dataVals = Object.values(data);

  const setClause = dataCols.map(col => `"${col}" = ?`).join(', ');
  const whereClause = whereCols.map(col => `"${col}" = ?`).join(' AND ');

  const sql = `UPDATE "${tableName}" SET ${setClause} WHERE ${whereClause}`;
  const allValues = [...dataVals, ...whereVals];

  try {
    await c.env.DB.prepare(sql).bind(...allValues).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 删除行
app.delete('/api/tables/:name/rows', async (c) => {
  const tableName = c.req.param('name');
  const where = await c.req.json();

  if (typeof where !== 'object') {
    return c.json({ error: 'Invalid where object' }, 400);
  }

  const whereCols = Object.keys(where);
  const whereVals = Object.values(where);

  const whereClause = whereCols.map(col => `"${col}" = ?`).join(' AND ');
  const sql = `DELETE FROM "${tableName}" WHERE ${whereClause}`;

  try {
    await c.env.DB.prepare(sql).bind(...whereVals).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 前端页面
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare DB Admin</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #333; margin-bottom: 20px; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
        .tab-btn { padding: 10px 20px; border: none; background: #e0e0e0; cursor: pointer; border-radius: 5px; font-size: 14px; }
        .tab-btn.active { background: #0066cc; color: white; }
        .tab-content { display: none; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .tab-content.active { display: block; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: 500; }
        input, select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
        button { padding: 8px 16px; border: none; background: #0066cc; color: white; cursor: pointer; border-radius: 4px; margin-right: 5px; }
        button:hover { background: #0055aa; }
        button.danger { background: #dc3545; }
        button.danger:hover { background: #c82333; }
        button.secondary { background: #6c757d; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #f8f9fa; font-weight: 600; }
        tr:hover { background: #f8f9fa; }
        .column-item { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; }
        .column-item input, .column-item select { width: auto; flex: 1; }
        .pagination { display: flex; justify-content: center; gap: 10px; margin-top: 15px; align-items: center; }
        .alert { padding: 10px; border-radius: 4px; margin-bottom: 15px; }
        .alert-success { background: #d4edda; color: #155724; }
        .alert-error { background: #f8d7da; color: #721c24; }
        .checkbox-group { display: flex; gap: 15px; margin-top: 5px; }
        .checkbox-group label { display: flex; align-items: center; gap: 5px; font-weight: normal; }
        .checkbox-group input { width: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🗄️ Cloudflare Database Admin</h1>
        
        <div class="tabs">
            <button class="tab-btn active" onclick="showTab('tables')">Tables</button>
            <button class="tab-btn" onclick="showTab('data')">Data</button>
        </div>
        
        <div id="tables-tab" class="tab-content active">
            <h2>Create New Table</h2>
            <div class="form-group">
                <label>Table Name</label>
                <input type="text" id="new-table-name" placeholder="e.g., users">
            </div>
            
            <h3>Columns</h3>
            <div id="columns-container"></div>
            <button class="secondary" onclick="addTableColumn()" style="margin-top: 10px;">+ Add Column</button>
            
            <div style="margin-top: 20px;">
                <button onclick="createTable()">Create Table</button>
            </div>
            
            <hr style="margin: 30px 0;">
            
            <h2>Existing Tables</h2>
            <div id="tables-list"></div>
        </div>
        
        <div id="data-tab" class="tab-content">
            <h2>Data Management</h2>
            <div class="form-group">
                <label>Select Table</label>
                <select id="table-select" onchange="loadTableData()"></select>
            </div>
            
            <div style="margin-bottom: 15px;">
                <button class="secondary" onclick="showAddRowForm()">+ Add Row</button>
            </div>
            
            <div id="add-row-form" style="display:none; background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 15px;"></div>
            
            <div id="table-data"></div>
            <div id="pagination"></div>
        </div>
    </div>

    <script>
        let columns = [];
        let currentPage = 1;
        let currentTable = '';
        let tableSchema = [];
        
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
            if (tabName === 'data') loadTablesForSelect();
        }
        
        function addTableColumn() {
            const colName = prompt('Column Name:');
            if (!colName) return;
            
            const colType = prompt('Column Type (TEXT, INTEGER, REAL, BLOB):', 'TEXT');
            if (!colType) return;
            
            const isPk = confirm('Primary Key?');
            const isNotNull = confirm('Not Null?');
            
            columns.push({ name: colName, type: colType, primary_key: isPk, not_null: isNotNull });
            updateColumnsDisplay();
        }
        
        function updateColumnsDisplay() {
            const container = document.getElementById('columns-container');
            container.innerHTML = '';
            columns.forEach((col, i) => {
                const div = document.createElement('div');
                div.className = 'column-item';
                div.innerHTML = \`
                    <input type="text" value="\${col.name}" readonly>
                    <input type="text" value="\${col.type}" readonly>
                    <span>PK: \${col.primary_key ? '✓' : '✗'}</span>
                    <span>NN: \${col.not_null ? '✓' : '✗'}</span>
                    <button class="danger" onclick="removeColumn(\${i})">Remove</button>
                \`;
                container.appendChild(div);
            });
        }
        
        function removeColumn(index) {
            columns.splice(index, 1);
            updateColumnsDisplay();
        }
        
        async function createTable() {
            const tableName = document.getElementById('new-table-name').value.trim();
            if (!tableName) { alert('Enter table name'); return; }
            if (columns.length === 0) { alert('Add at least one column'); return; }
            
            try {
                const response = await fetch('/api/tables', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table_name: tableName, columns })
                });
                
                const result = await response.json();
                if (response.ok) {
                    alert('Table created successfully!');
                    document.getElementById('new-table-name').value = '';
                    columns = [];
                    updateColumnsDisplay();
                    listTables();
                } else {
                    alert('Error: ' + result.error);
                }
            } catch (e) {
                alert('Network error: ' + e.message);
            }
        }
        
        async function listTables() {
            try {
                const response = await fetch('/api/tables');
                const tables = await response.json();
                const container = document.getElementById('tables-list');
                container.innerHTML = '';
                
                if (tables.length === 0) {
                    container.innerHTML = '<p>No tables yet.</p>';
                    return;
                }
                
                tables.forEach(table => {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding: 15px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;';
                    div.innerHTML = \`
                        <strong>\${table.name}</strong>
                        <div>
                            <button class="secondary" onclick="viewSchema('\${table.name}')">Schema</button>
                            <button class="danger" onclick="deleteTable('\${table.name}')">Delete</button>
                        </div>
                    \`;
                    container.appendChild(div);
                });
            } catch (e) {
                console.error(e);
            }
        }
        
        async function deleteTable(name) {
            if (!confirm('Are you sure you want to delete table "' + name + '"? This cannot be undone.')) return;
            
            try {
                const response = await fetch('/api/tables/' + name, { method: 'DELETE' });
                if (response.ok) {
                    alert('Table deleted');
                    listTables();
                } else {
                    const error = await response.json();
                    alert('Error: ' + error.error);
                }
            } catch (e) {
                alert('Network error');
            }
        }
        
        async function viewSchema(name) {
            try {
                const response = await fetch('/api/tables/' + name + '/schema');
                const schema = await response.json();
                let schemaText = 'Table: ' + name + '\\n\\nColumns:\\n';
                schema.forEach(col => {
                    schemaText += '- ' + col.name + ' (' + col.type + ')' + (col.pk ? ' [PK]' : '') + (col.notnull ? ' [NOT NULL]' : '') + '\\n';
                });
                alert(schemaText);
            } catch (e) {
                console.error(e);
            }
        }
        
        async function loadTablesForSelect() {
            try {
                const response = await fetch('/api/tables');
                const tables = await response.json();
                const select = document.getElementById('table-select');
                select.innerHTML = '<option value="">Select Table</option>';
                
                tables.forEach(table => {
                    const option = document.createElement('option');
                    option.value = table.name;
                    option.textContent = table.name;
                    select.appendChild(option);
                });
            } catch (e) {
                console.error(e);
            }
        }
        
        async function loadTableData(page = 1) {
            const tableName = document.getElementById('table-select').value;
            if (!tableName) {
                document.getElementById('table-data').innerHTML = '';
                document.getElementById('pagination').innerHTML = '';
                return;
            }
            
            currentTable = tableName;
            currentPage = page;
            
            try {
                const response = await fetch('/api/tables/' + tableName + '/rows?page=' + page + '&page_size=20');
                const result = await response.json();
                
                if (result.data && result.data.length > 0) {
                    tableSchema = Object.keys(result.data[0]);
                    const keys = tableSchema;
                    let html = '<table><tr>';
                    keys.forEach(k => html += '<th>' + k + '</th>');
                    html += '<th>Actions</th></tr>';
                    
                    result.data.forEach(row => {
                        html += '<tr>';
                        keys.forEach(key => html += '<td>' + (row[key] !== null ? row[key] : 'NULL') + '</td>');
                        html += '<td><button class="secondary" onclick=\'editRow("'+tableName+'", '+JSON.stringify(row).replace(/"/g, '&quot;')+')\'>Edit</button> <button class="danger" onclick=\'deleteRow("'+tableName+'", '+JSON.stringify(row).replace(/"/g, '&quot;')+')\'>Delete</button></td></tr>';
                    });
                    
                    html += '</table>';
                    document.getElementById('table-data').innerHTML = html;
                    
                    // Pagination
                    let pagHtml = '<div class="pagination">';
                    if (result.pagination.page > 1) {
                        pagHtml += '<button onclick="loadTableData(' + (result.pagination.page - 1) + ')">Previous</button>';
                    }
                    pagHtml += '<span>Page ' + result.pagination.page + ' of ' + result.pagination.pages + '</span>';
                    if (result.pagination.page < result.pagination.pages) {
                        pagHtml += '<button onclick="loadTableData(' + (result.pagination.page + 1) + ')">Next</button>';
                    }
                    pagHtml += '</div>';
                    document.getElementById('pagination').innerHTML = pagHtml;
                } else {
                    document.getElementById('table-data').innerHTML = '<p>No data found</p>';
                    document.getElementById('pagination').innerHTML = '';
                }
            } catch (e) {
                console.error(e);
                document.getElementById('table-data').innerHTML = '<p>Error loading data</p>';
            }
        }
        
        async function showAddRowForm() {
            const tableName = document.getElementById('table-select').value;
            if (!tableName) { alert('Select a table first'); return; }
            
            try {
                const response = await fetch('/api/tables/' + tableName + '/schema');
                const schema = await response.json();
                
                let html = '<h3>Add New Row</h3><div class="form-group">';
                schema.forEach(col => {
                    html += '<label>' + col.name + ' (' + col.type + ')</label>';
                    if (col.type === 'INTEGER' && col.pk) {
                        html += '<input type="number" id="col_' + col.name + '" placeholder="' + col.name + '">';
                    } else if (col.type === 'REAL') {
                        html += '<input type="number" step="0.01" id="col_' + col.name + '" placeholder="' + col.name + '">';
                    } else {
                        html += '<input type="text" id="col_' + col.name + '" placeholder="' + col.name + '">';
                    }
                });
                html += '</div><button onclick="submitNewRow()">Save</button> <button class="secondary" onclick="document.getElementById(\'add-row-form\').style.display=\'none\'">Cancel</button>';
                
                document.getElementById('add-row-form').innerHTML = html;
                document.getElementById('add-row-form').style.display = 'block';
            } catch (e) {
                console.error(e);
            }
        }
        
        async function submitNewRow() {
            const tableName = document.getElementById('table-select').value;
            const rowData = {};
            
            tableSchema.forEach(col => {
                const value = document.getElementById('col_' + col).value;
                if (value !== '') rowData[col] = value;
            });
            
            try {
                const response = await fetch('/api/tables/' + tableName + '/rows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(rowData)
                });
                
                if (response.ok) {
                    document.getElementById('add-row-form').style.display = 'none';
                    loadTableData(currentPage);
                } else {
                    const error = await response.json();
                    alert('Error: ' + error.error);
                }
            } catch (e) {
                alert('Network error');
            }
        }
        
        async function editRow(tableName, row) {
            const newData = prompt('Enter updated values as JSON:', JSON.stringify(row));
            if (!newData) return;
            
            try {
                const parsed = JSON.parse(newData);
                const where = {};
                tableSchema.forEach(key => {
                    if (row[key] !== undefined) where[key] = row[key];
                });
                
                const response = await fetch('/api/tables/' + tableName + '/rows', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ where, data: parsed })
                });
                
                if (response.ok) {
                    loadTableData(currentPage);
                } else {
                    const error = await response.json();
                    alert('Error: ' + error.error);
                }
            } catch (e) {
                alert('Invalid JSON');
            }
        }
        
        async function deleteRow(tableName, row) {
            if (!confirm('Delete this row?')) return;
            
            const where = {};
            tableSchema.forEach(key => {
                if (row[key] !== undefined) where[key] = row[key];
            });
            
            try {
                const response = await fetch('/api/tables/' + tableName + '/rows', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(where)
                });
                
                if (response.ok) {
                    loadTableData(currentPage);
                } else {
                    const error = await response.json();
                    alert('Error: ' + error.error);
                }
            } catch (e) {
                alert('Network error');
            }
        }
        
        listTables();
    </script>
</body>
</html>`);
});

export default app;
