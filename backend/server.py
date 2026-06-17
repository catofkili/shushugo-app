"""
Master Nihongo - 云端同步后端服务

功能：
- 用户注册/登录
- 学习进度同步
- 数据备份和恢复

技术栈：
- Python 3 + FastAPI
- PostgreSQL / SQLite
- JWT 认证
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import sqlite3
import jwt
import bcrypt
from datetime import datetime, timedelta
import os

# 配置
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 天

app = FastAPI(title="Master Nihongo API", version="1.0.0")
security = HTTPBearer()

# CORS 配置 - 允许所有来源（生产环境需要限制）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库路径
DB_PATH = "sync_data.db"


# 数据模型
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    email: str


class SyncData(BaseModel):
    db_data: str  # Base64 编码的数据库文件
    last_modified: str


# 数据库初始化
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 用户表
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            created_at TEXT NOT NULL,
            last_login TEXT
        )
    """)

    # 同步数据表
    c.execute("""
        CREATE TABLE IF NOT EXISTS sync_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            db_data TEXT NOT NULL,
            last_modified TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    conn.commit()
    conn.close()


init_db()


# 工具函数
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int, email: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    return decode_token(credentials.credentials)


# API 端点
@app.get("/")
def root():
    return {
        "message": "Master Nihongo Sync API",
        "version": "1.0.0",
        "status": "running"
    }


@app.post("/api/auth/register", response_model=TokenResponse)
def register(user: UserRegister):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 检查邮箱是否已存在
    c.execute("SELECT id FROM users WHERE email = ?", (user.email,))
    if c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")

    # 创建用户
    password_hash = hash_password(user.password)
    now = datetime.utcnow().isoformat()

    c.execute(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
        (user.email, password_hash, user.display_name, now)
    )
    user_id = c.lastrowid
    conn.commit()
    conn.close()

    # 生成 token
    token = create_token(user_id, user.email)

    return TokenResponse(
        access_token=token,
        user_id=user_id,
        email=user.email
    )


@app.post("/api/auth/login", response_model=TokenResponse)
def login(credentials: UserLogin):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 查找用户
    c.execute(
        "SELECT id, email, password_hash FROM users WHERE email = ?",
        (credentials.email,)
    )
    row = c.fetchone()

    if not row or not verify_password(credentials.password, row[2]):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id, email = row[0], row[1]

    # 更新最后登录时间
    c.execute(
        "UPDATE users SET last_login = ? WHERE id = ?",
        (datetime.utcnow().isoformat(), user_id)
    )
    conn.commit()
    conn.close()

    # 生成 token
    token = create_token(user_id, email)

    return TokenResponse(
        access_token=token,
        user_id=user_id,
        email=email
    )


@app.get("/api/sync/pull")
def pull_sync_data(current_user: dict = Depends(get_current_user)):
    """拉取最新的同步数据"""
    user_id = int(current_user["sub"])

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute(
        "SELECT db_data, last_modified FROM sync_data WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        (user_id,)
    )
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="No sync data found")

    return {
        "db_data": row[0],
        "last_modified": row[1]
    }


@app.post("/api/sync/push")
def push_sync_data(data: SyncData, current_user: dict = Depends(get_current_user)):
    """推送同步数据"""
    user_id = int(current_user["sub"])

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    now = datetime.utcnow().isoformat()

    c.execute(
        "INSERT INTO sync_data (user_id, db_data, last_modified, created_at) VALUES (?, ?, ?, ?)",
        (user_id, data.db_data, data.last_modified, now)
    )
    conn.commit()
    conn.close()

    return {
        "status": "success",
        "message": "Sync data uploaded",
        "timestamp": now
    }


@app.get("/api/user/profile")
def get_profile(current_user: dict = Depends(get_current_user)):
    """获取用户信息"""
    user_id = int(current_user["sub"])

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute(
        "SELECT email, display_name, created_at, last_login FROM users WHERE id = ?",
        (user_id,)
    )
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "email": row[0],
        "display_name": row[1],
        "created_at": row[2],
        "last_login": row[3]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
