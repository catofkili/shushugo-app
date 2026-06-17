# Master Nihongo 后端 API

## 功能

- ✅ 用户注册/登录
- ✅ JWT 认证
- ✅ 学习数据同步（上传/下载）
- ✅ 用户信息管理

## 安装

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

## 本地运行

```bash
python server.py
```

访问 http://localhost:8080/docs 查看 API 文档

## 环境变量

```bash
export JWT_SECRET_KEY="your-super-secret-key"
```

⚠️ **生产环境必须修改密钥！**

## API 端点

### 认证
- `POST /api/auth/register` - 注册新用户
- `POST /api/auth/login` - 用户登录

### 同步
- `GET /api/sync/pull` - 拉取学习数据（需要认证）
- `POST /api/sync/push` - 推送学习数据（需要认证）

### 用户
- `GET /api/user/profile` - 获取用户信息（需要认证）

## 部署

### 推荐服务

#### 1. Railway (推荐 - 免费额度)
```bash
# 安装 Railway CLI
npm i -g @railway/cli

# 登录
railway login

# 初始化项目
railway init

# 部署
railway up
```

#### 2. Fly.io (免费额度)
```bash
# 安装 Fly CLI
curl -L https://fly.io/install.sh | sh

# 登录
fly auth login

# 部署
fly launch
fly deploy
```

#### 3. Render (免费额度)
1. 访问 https://render.com
2. 连接 GitHub 仓库
3. 选择 Web Service
4. 设置：
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

### 部署后配置

1. 设置环境变量 `JWT_SECRET_KEY`
2. 记录 API URL
3. 更新前端代码中的 API 地址

## 数据库

使用 SQLite（开发）或 PostgreSQL（生产）

### 迁移到 PostgreSQL

```python
# 修改 server.py
import psycopg2
from urllib.parse import urlparse

DATABASE_URL = os.getenv("DATABASE_URL")
```

## 安全注意事项

1. ✅ 使用 HTTPS（生产环境）
2. ✅ 修改 JWT 密钥
3. ⚠️ 限制 CORS 来源
4. ⚠️ 添加速率限制
5. ⚠️ 输入验证和清理

## 前端集成

```typescript
// src/lib/sync-api.ts
const API_URL = 'https://your-api.railway.app';

async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return response.json();
}

async function syncPush(token: string, dbData: string) {
  const response = await fetch(`${API_URL}/api/sync/push`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      db_data: dbData,
      last_modified: new Date().toISOString()
    })
  });
  return response.json();
}
```

## 监控

访问 `/docs` 查看自动生成的 API 文档（Swagger UI）

## 故障排除

### 问题：bcrypt 安装失败
```bash
pip install --upgrade pip setuptools wheel
pip install bcrypt
```

### 问题：端口被占用
```bash
# 修改端口
uvicorn server:app --port 8081
```

## 许可

个人学习项目
