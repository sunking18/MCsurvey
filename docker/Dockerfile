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

# 前端静态文件（Nginx 会直接 serve，但后端也需要能找到根目录文件）
COPY index.html poster.html admin.html MP_verify_*.txt ../
COPY assets/ ../assets/

EXPOSE 3000

CMD ["node", "server.js"]
