# Cloudflare Database API

一个基于 Cloudflare Workers + D1 数据库的完整数据库管理系统，支持自建表格、字段管理、数据 CRUD 操作和分页查询。

## 功能特性

- ✅ **表管理**: 创建/删除表，自定义表名
- ✅ **字段管理**: 动态添加/删除列，支持 TEXT, INTEGER, REAL, BLOB 类型
- ✅ **主键支持**: 可设置 PRIMARY KEY 和 NOT NULL 约束
- ✅ **数据操作**: 增删改查 (CRUD) 完整支持
- ✅ **分页查询**: 可配置每页条数，默认 20 条，最大 100 条
- ✅ **图形界面**: 现代化 UI，无需额外前端

## 部署到 Cloudflare

### 步骤 1: 创建 GitHub 仓库
将此代码推送到你的 GitHub 仓库

### 步骤 2: 连接 Cloudflare Pages
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create application** → **Pages**
3. 选择 **Connect to Git**
4. 选择你的仓库

### 步骤 3: 配置构建设置
- **Build command**: `npm install --production`
- **Deploy command**: `npx wrangler deploy`

### 步骤 4: 创建 D1 数据库
在部署前或部署后，需要创建 D1 数据库：

```bash
# 安装 wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建数据库
wrangler d1 create my-database

# 复制输出的 database_id
```

### 步骤 5: 更新 wrangler.toml
将 `wrangler.toml` 中的 `database_id` 替换为你刚创建的数据库 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-database"
database_id = "你的数据库 ID"
```

### 步骤 6: 重新部署
在 Cloudflare Pages 中触发重新部署，或在本地运行：
```bash
npx wrangler deploy
```

## API 接口

### 表管理
- `GET /api/tables` - 获取所有表
- `POST /api/tables` - 创建表
- `DELETE /api/tables/:name` - 删除表
- `GET /api/tables/:name/schema` - 获取表结构

### 列管理
- `POST /api/tables/:name/columns` - 添加列
- `DELETE /api/tables/:name/columns/:column` - 删除列

### 数据操作
- `GET /api/tables/:name/rows?page=1&page_size=20` - 分页查询
- `POST /api/tables/:name/rows` - 插入行
- `PUT /api/tables/:name/rows` - 更新行
- `DELETE /api/tables/:name/rows` - 删除行

## 使用示例

### 创建表
```json
POST /api/tables
{
  "table_name": "users",
  "columns": [
    {"name": "id", "type": "INTEGER", "primary_key": true},
    {"name": "name", "type": "TEXT", "not_null": true},
    {"name": "email", "type": "TEXT"}
  ]
}
```

### 插入数据
```json
POST /api/tables/users/rows
{
  "id": 1,
  "name": "张三",
  "email": "zhangsan@example.com"
}
```

### 分页查询
```
GET /api/tables/users/rows?page=1&page_size=10
```

## 注意事项

- Cloudflare D1 数据库有大小限制，请合理设计表结构
- 单个 Worker 文件大小限制为 25MB（本代码约 25KB，完全符合）
- 免费套餐有每日查询次数限制

## 技术栈
- **运行时**: Cloudflare Workers
- **框架**: Hono (TypeScript)
- **数据库**: Cloudflare D1 (SQLite)