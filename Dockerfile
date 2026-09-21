# ═══════════════════════════════════════════════════════════════════
# modbus-master —— 主站（Next.js 自定义服务器 + WebSocket）
#
# ⚠️ 本文件的构建/启动方式与 modbus-slave **刻意不同**，是跟随各自现状，
#    不是疏漏：
#        build = next build + tsup 打包  →  dist/server.js
#        run   = node dist/server.js
#    原因（coze 模板来源 + 历史路径依赖）见 DEPLOY.md §2.3。
#    想统一的话先看那节列的两个约束，别在这里单方面改。
#
# ⚠️ 两条维护红线（都是实测踩出来的，别改回去）：
#    1. Dockerfile **不支持行内注释**。`COPY a b   # 说明` 里的 `# 说明`
#       会被当成参数（源路径），报错形如
#       `failed to calculate checksum ...: "/#": not found`。注释一律独占一行。
#    2. runner 阶段 `pnpm install` **必须在 `ENV NODE_ENV=production` 之前**，
#       否则 pnpm 自动跳过 devDependencies，Next 会在启动时联网自己装 typescript。
#       详见该处注释。
# ═══════════════════════════════════════════════════════════════════

# 与 .coze 的 requires = ["nodejs-24"] 对齐。换版本改这一行即可。
ARG NODE_VERSION=24

# ── Stage 1：构建 ──────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder

# 国内网络下用镜像源拉 pnpm，避免 corepack 卡住；不需要可删这两行。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com

# pnpm 版本对齐 package.json 的 "packageManager": "pnpm@9.0.0"。
# ⚠️ 不要升到 pnpm 10+：v10 起默认**拒绝执行依赖的构建脚本**，
#    原生模块（serialport）的准备步骤会被跳过。
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 先只拷依赖清单 → 这层能被缓存，改业务代码不会触发重装
COPY package.json pnpm-lock.yaml .npmrc ./

RUN pnpm install --frozen-lockfile

# 再拷源码（node_modules / .next / dist 已被 .dockerignore 排除）
COPY . .

# ⚠️ next build 峰值要 1.5~2GB 堆，不放开上限会在小机器上 OOM
ENV NODE_OPTIONS=--max-old-space-size=2048

# ① 前端产物 → .next/
RUN pnpm exec next build

# ② 自定义服务器 → dist/server.js
#    tsup 会把 server.ts 引用到的 TS 全部内联，@/ 别名也在这一步解析掉，
#    所以运行期**不再需要** src/ 和 tsconfig.json。
RUN pnpm exec tsup src/server.ts \
      --format cjs --platform node --target node20 \
      --outDir dist --no-splitting --no-minify

# ── Stage 2：运行 ──────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# ⚠️⚠️ 安装依赖，**必须放在 NODE_ENV=production 之前**，顺序不能调。
#    Next 16 运行期加载 next.config.ts 时需要有 typescript 包，而它在 devDependencies 里。
#    想让 Next 拿到它，得同时满足两件事：
#      · 不加 --prod              （加了会跳过 devDependencies）
#      · 装的时候 NODE_ENV 还不是 production（否则 pnpm 会自动跳过 devDependencies）
#    任一条不满足，Next 就会在**启动时自己联网去装** typescript，日志里出现：
#      ⚠ Installing TypeScript as it was not found while loading "next.config.ts".
#    后果：容器启动依赖网络、镜像不再自包含、离线环境直接起不来。
#    （两条都是实测踩过的。这个文件最初就是踩了第二条才又失败一遍。）
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ── 依赖装完之后，再切生产环境变量 ──

# ⚠️ 唯一的"生产模式"开关。不设 = Next 跑 dev 模式：不报错，但极慢
ENV COZE_PROJECT_ENV=PROD
ENV NODE_ENV=production
ENV DEPLOY_RUN_PORT=5000
# ⚠️ 必须显式写死：Docker 默认会把容器 ID 塞进 HOSTNAME，
#    而 server.ts 会读它传给 next()。不覆盖就会拿到一串容器 ID。
ENV HOSTNAME=0.0.0.0

# ── 运行期需要的产物（注释必须独占一行，见文件头红线 1）──

# Next 生产产物
COPY --from=builder /app/.next ./.next

# 自定义服务器产物（tsup 输出，自包含）
COPY --from=builder /app/dist ./dist

# Next 运行期仍会读配置
COPY --from=builder /app/next.config.ts ./next.config.ts

# 静态资源
COPY --from=builder /app/public ./public

# 与宿主机同一套脚本，便于进容器排查
COPY --from=builder /app/scripts ./scripts

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DEPLOY_RUN_PORT||5000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ⚠️ 绝对不要改成 next start —— 它会跳过 server.on('upgrade')，/ws/modbus 直接消失，
#    表现是"页面能开、按钮能点，但所有实时功能静默失效"。
#    等价于 scripts/start.sh 里的 `PORT=$DEPLOY_RUN_PORT node dist/server.js`。
CMD ["node", "dist/server.js"]
