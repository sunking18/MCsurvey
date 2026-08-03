#!/bin/bash
# ============================================================
# 问卷系统 · Docker 一键部署脚本
# 用法：bash docker/deploy.sh
# 前提：服务器已装 Docker + Docker Compose（或 docker compose V2）
# ============================================================
set -e

echo "============================================"
echo "  中石油亲子心理问卷 — Docker 部署"
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 1) 检查 Docker
if ! command -v docker &>/dev/null; then
    echo "❌ 未检测到 Docker，请先安装"
    echo "   curl -fsSL https://get.docker.com | sh"
    exit 1
fi
echo "✅ Docker: $(docker --version)"

# 2) 检查 Docker Compose
COMPOSE_CMD="docker compose"
if ! $COMPOSE_CMD version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    if ! $COMPOSE_CMD version &>/dev/null 2>&1; then
        echo "❌ 未检测到 Docker Compose，请先安装"
        echo "   dnf install -y docker-compose-plugin  # 或 pip3 install docker-compose"
        exit 1
    fi
fi
echo "✅ Compose: $($COMPOSE_CMD version | head -1)"

# 3) 检查 .env
cd "$SCRIPT_DIR"
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env，从 .env.example 复制..."
    cp .env.example .env
    echo "   请编辑 docker/.env 填入真实密钥后重新运行此脚本"
    exit 1
fi
echo "✅ 环境变量已配置"

# 4) 构建并启动
echo ""
echo "📦 构建镜像..."
$COMPOSE_CMD build

echo ""
echo "🚀 启动服务..."
$COMPOSE_CMD up -d

# 5) 等待 MySQL 就绪
echo ""
echo "⏳ 等待 MySQL 就绪..."
for i in $(seq 1 30); do
    if $COMPOSE_CMD exec mysql mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-Survey@2026!Secure}" &>/dev/null; then
        echo "✅ MySQL 已就绪"
        break
    fi
    sleep 2
done

# 6) 检查服务状态
echo ""
echo "📋 服务状态："
$COMPOSE_CMD ps

echo ""
echo "🔍 健康检查..."
sleep 3
curl -sf http://localhost:3000/api/health && echo "" || echo "⚠️ 后端尚未完全启动，稍后再试"

echo ""
echo "============================================"
echo "  ✅ 部署完成！"
echo "============================================"
echo ""
echo "  访问地址："
echo "    问卷首页 → http://$(hostname -I | awk '{print $1}') 或 https://xunxinli.com"
echo "    管理后台 → http://$(hostname -I | awk '{print $1}')/admin.html"
echo "    二维码海报 → http://$(hostname -I | awk '{print $1}')/poster.html"
echo ""
echo "  常用命令："
echo "    查看日志 → cd docker && $COMPOSE_CMD logs -f app"
echo "    重启服务 → cd docker && $COMPOSE_CMD restart app"
echo "    停止全部 → cd docker && $COMPOSE_CMD down"
echo "    更新代码 → git pull && cd docker && $COMPOSE_CMD up -d --build app"
echo ""
echo "  ⚠️ 下一步：申请 HTTPS 证书"
echo "    docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d xunxinli.com -d www.xunxinli.com"
echo "    申请成功后重启 nginx：docker compose restart nginx"
echo "============================================"
