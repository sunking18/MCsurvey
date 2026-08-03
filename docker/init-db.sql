-- 数据库与用户已由 docker-compose 环境变量 MYSQL_DATABASE / MYSQL_USER 自动创建，
-- 表结构（responses / sessions）由后端 server.js 在首次连接时自动建表。
-- 本文件仅用于满足 docker-compose 对 init-db.sql 的挂载要求，内容留空即可。
SELECT 'init ok' AS status;
