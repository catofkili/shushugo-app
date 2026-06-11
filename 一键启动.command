#!/bin/bash
# 日语背词 - 一键启动脚本

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "🚀 日语背词 - 启动中..."
echo ""

# 检查后端是否已运行
check_backend() {
    curl -s http://127.0.0.1:8800/api/stats > /dev/null 2>&1
    return $?
}

# 启动后端
start_backend() {
    echo "📡 启动后端服务器..."

    # 检查虚拟环境
    if [ ! -d ".venv" ]; then
        echo "⚠️  虚拟环境不存在，正在创建..."
        python3 -m venv .venv
        source .venv/bin/activate
        pip install -r requirements.txt
    else
        source .venv/bin/activate
    fi

    # 后台启动服务器
    nohup python3 server.py > /tmp/japanese_vocab_server.log 2>&1 &
    BACKEND_PID=$!
    echo "   后端 PID: $BACKEND_PID"

    # 等待服务器启动
    echo "   等待服务器就绪..."
    for i in {1..10}; do
        sleep 1
        if check_backend; then
            echo "   ✅ 后端服务器已就绪"
            return 0
        fi
    done

    echo "   ⚠️  后端启动可能有问题，但继续打开浏览器"
}

# 主流程
main() {
    if check_backend; then
        echo "✅ 后端服务器已在运行"
    else
        echo "📦 后端服务器未运行，正在启动..."
        start_backend
    fi

    echo ""
    echo "🌐 打开浏览器..."
    open "http://127.0.0.1:8800"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✨ 日语背词已启动！"
    echo ""
    echo "📍 访问地址: http://127.0.0.1:8800"
    echo "📝 日志文件: /tmp/japanese_vocab_server.log"
    echo ""
    echo "💡 提示："
    echo "   • 关闭此窗口不会停止后端服务器"
    echo "   • 查看日志: tail -f /tmp/japanese_vocab_server.log"
    echo "   • 停止服务: pkill -f server.py"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

main
