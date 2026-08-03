# 阶段一：安装依赖
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev

# 阶段二：运行镜像（精简，不含源码）
FROM node:20-alpine
WORKDIR /app

# 安装时区数据（避免时间差 8 小时）
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

# 从 builder 复制 node_modules
COPY --from=builder /app/node_modules ./node_modules
# 复制后端代码
COPY backend/ ./

# 前端静态文件（index.html / poster.html / admin.html / assets / MP_verify_*.txt）
# 不在构建期 COPY：运行时由 docker-compose 的 bind mount 从 ../survey 与
# ../MP_verify_*.txt 直接挂进容器（/app/...），改文件无需重新 build。

EXPOSE 3000

CMD ["node", "server.js"]
