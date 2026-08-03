#!/usr/bin/env bash
# 服务器部署脚本：拉取最新代码并重建容器
# 用法（在仓库根目录 /data/MCsurvey-docker/docker 下执行）：
#   bash deploy.sh
set -e

cd "$(dirname "$0")"

echo ">>> 1/3 拉取最新代码（GitHub 公开仓库，无需鉴权）"
git fetch origin
git reset --hard origin/main

echo ">>> 2/3 重新部署容器（compose 路径已对齐 ./survey）"
docker compose -f docker-compose-subdomain.yml up -d

echo ">>> 3/3 完成"
echo "问卷页:   https://survey.xunxinli.com/"
echo "管理后台: https://survey.xunxinli.com/admin.html  (密钥 admin123)"
echo "接口自检: https://survey.xunxinli.com/api/stats?key=admin123"
