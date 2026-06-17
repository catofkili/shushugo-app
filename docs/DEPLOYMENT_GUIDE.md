# 云服务部署指南

Master Nihongo 后端 API 可以部署到任何支持 Python 的云平台。

## 🎯 推荐平台对比

| 平台 | 免费额度 | 优点 | 缺点 |
|------|---------|------|------|
| **Railway** | $5/月免费 | ✅ 简单易用<br>✅ 自动部署<br>✅ 内置数据库 | 需要信用卡 |
| **Fly.io** | 3个免费应用 | ✅ 全球边缘网络<br>✅ PostgreSQL 支持 | 配置稍复杂 |
| **Render** | 完全免费 | ✅ 零配置<br>✅ GitHub 集成 | 冷启动慢 |
| **Heroku** | 免费(限制多) | ✅ 老牌平台 | 需要休眠管理 |

## 📦 方案一：Railway (推荐)

### 1. 安装 Railway CLI
```bash
npm i -g @railway/cli
```

### 2. 登录
```bash
railway login
```

### 3. 初始化项目
```bash
cd backend
railway init
```

选择 "Create a new project"

### 4. 部署
```bash
railway up
```

### 5. 设置环境变量
```bash
railway variables set JWT_SECRET_KEY="your-super-secret-key-change-this"
```

### 6. 获取 URL
```bash
railway domain
```

记录下显示的 URL，如 `https://your-app.railway.app`

### 7. 添加数据库（可选，升级到 PostgreSQL）
```bash
railway add postgresql
```

## 📦 方案二：Fly.io

### 1. 安装 Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
```

### 2. 登录
```bash
fly auth login
```

### 3. 创建 fly.toml
```bash
cd backend
cat > fly.toml << 'EOF'
app = "master-nihongo-api"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "8080"

[[services]]
  http_checks = []
  internal_port = 8080
  processes = ["app"]
  protocol = "tcp"
  script_checks = []

  [[services.ports]]
    force_https = true
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
EOF
```

### 4. 部署
```bash
fly launch
fly deploy
```

### 5. 设置密钥
```bash
fly secrets set JWT_SECRET_KEY="your-super-secret-key"
```

### 6. 查看应用
```bash
fly open
```

## 📦 方案三：Render

### 1. 准备代码
确保 backend 目录包含：
- `server.py`
- `requirements.txt`

### 2. 推送到 GitHub
```bash
cd ~/Documents/master-nihongo-ios
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/master-nihongo.git
git push -u origin main
```

### 3. 在 Render 创建服务
1. 访问 https://render.com
2. 注册/登录
3. 点击 "New +" > "Web Service"
4. 连接 GitHub 仓库

### 4. 配置
- **Name**: master-nihongo-api
- **Root Directory**: backend
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`

### 5. 环境变量
添加：
- Key: `JWT_SECRET_KEY`
- Value: `your-super-secret-key-change-this`

### 6. 部署
点击 "Create Web Service"，等待构建完成。

## 🔗 前端集成

### 创建同步 API 模块

```typescript
// frontend/src/lib/sync-api.ts
const API_URL = 'https://your-api-url.com'; // 替换为你的 API URL

interface AuthResponse {
  access_token: string;
  user_id: number;
  email: string;
}

interface SyncResponse {
  db_data: string;
  last_modified: string;
}

// 注册
export async function register(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    throw new Error('Registration failed');
  }

  return response.json();
}

// 登录
export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    throw new Error('Login failed');
  }

  return response.json();
}

// 拉取同步数据
export async function pullSyncData(token: string): Promise<SyncResponse> {
  const response = await fetch(`${API_URL}/api/sync/pull`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Pull failed');
  }

  return response.json();
}

// 推送同步数据
export async function pushSyncData(token: string, dbData: string): Promise<void> {
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

  if (!response.ok) {
    throw new Error('Push failed');
  }
}
```

### 使用示例

```typescript
import { login, pushSyncData, pullSyncData } from './lib/sync-api';
import { exportDatabase, importDatabase } from './lib/database';
import { Preferences } from '@capacitor/preferences';

// 登录
async function handleLogin(email: string, password: string) {
  try {
    const auth = await login(email, password);
    
    // 保存 token
    await Preferences.set({
      key: 'auth_token',
      value: auth.access_token
    });

    console.log('Logged in:', auth.email);
  } catch (error) {
    console.error('Login failed:', error);
  }
}

// 同步到云端
async function syncToCloud() {
  try {
    const { value: token } = await Preferences.get({ key: 'auth_token' });
    if (!token) {
      throw new Error('Not logged in');
    }

    // 导出数据库
    const dbData = exportDatabase();
    if (!dbData) {
      throw new Error('No database to sync');
    }

    // 转换为 Base64
    const base64 = btoa(String.fromCharCode(...dbData));

    // 推送到云端
    await pushSyncData(token, base64);

    console.log('✅ Synced to cloud');
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

// 从云端恢复
async function restoreFromCloud() {
  try {
    const { value: token } = await Preferences.get({ key: 'auth_token' });
    if (!token) {
      throw new Error('Not logged in');
    }

    // 拉取数据
    const syncData = await pullSyncData(token);

    // 解码 Base64
    const binary = atob(syncData.db_data);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i);
    }

    // 导入数据库
    await importDatabase(data);

    console.log('✅ Restored from cloud');
  } catch (error) {
    console.error('Restore failed:', error);
  }
}
```

## 🔐 安全配置

### 1. 生成强密钥
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 2. 限制 CORS（生产环境）
在 `server.py` 中修改：
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend-domain.com"],  # 只允许你的前端
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 3. 添加速率限制
```bash
pip install slowapi
```

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/auth/login")
@limiter.limit("5/minute")
def login(...):
    ...
```

## 📊 监控

### Railway
```bash
railway logs
```

### Fly.io
```bash
fly logs
```

### Render
访问 Dashboard > Logs 标签

## 🧪 测试 API

### 使用 curl
```bash
# 注册
curl -X POST https://your-api.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# 登录
curl -X POST https://your-api.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

### 访问文档
浏览器打开: `https://your-api.com/docs`

## 💰 成本估算

- **Railway**: $5/月免费额度，超出按使用量计费
- **Fly.io**: 3个免费应用，足够个人使用
- **Render**: 完全免费，但有性能限制
- **数据库**: SQLite 足够个人使用，PostgreSQL 需要额外费用

## 🎓 下一步

1. 部署后端到云平台
2. 记录 API URL
3. 在前端代码中替换 `API_URL`
4. 实现登录/注册界面
5. 添加同步按钮
6. 测试完整流程
