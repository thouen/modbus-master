# AGENTS.md - ModBus Master Web Application

## 项目概览
ModBus 主站网页应用，支持多协议（Serial/TCP）、多模式（ASCII/RTU）通信，基于 modbus-serial 库实现协议层。提供多格式寄存器数据展示、实时日志、标签页管理和配置持久化（localStorage + JSON 导入导出）功能。支持中英文切换。

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **State**: React Context + useReducer
- **Protocol**: modbus-serial v8 + serialport v13
- **Communication**: WebSocket (/ws/modbus)

## 目录结构
```
src/
├── app/
│   ├── layout.tsx              # 根布局（dark theme + 语言切换）
│   ├── page.tsx                # 主页面（三栏布局）
│   └── globals.css             # 全局样式（工业暗色主题）
├── components/
│   ├── ui/                     # shadcn/ui 组件库
│   ├── connection-panel.tsx    # 连接管理面板（卡片式 + 导入导出）
│   ├── register-tab-manager.tsx # 标签页管理 + 数据表格 + 写入弹窗
│   └── log-viewer.tsx          # 实时日志查看器（按连接筛选）
├── hooks/
│   ├── use-i18n.tsx            # 国际化 Context（中/英）
│   ├── use-app-state.tsx       # 全局状态管理（localStorage 持久化）
│   └── use-modbus-ws.ts        # WebSocket 通信 Hook
├── ws-handlers/
│   └── modbus.ts               # WebSocket 服务端处理器（ModBus 操作）
└── lib/
    ├── i18n.ts                 # 中英文翻译字典
    ├── modbus-types.ts         # ModBus 协议类型定义（含 RegisterArea / ConnectionRegisterImage）
    ├── connection-image.ts     # ⭐ R3：连接设备镜像内核（分配 / 自动扩容 / 打包读写）
    ├── modbus-client.ts        # modbus-serial 协议层封装
    ├── modbus-utils.ts         # 工具函数（数据格式化/转换、registerWindowKey）
    └── utils.ts                # 通用工具（cn）
```

> ⭐ **R3 后的数据流**（值不再挂在标签上）：
> ```
> 设备 ──协议──> modbus-client ──data(寄存器单位)──> use-modbus-ws
>                                                      │
>                                     packBitsToWords（仅位区）
>                                                      ▼
>                       registerImages[connectionId]（每连接 4 条 Uint16Array，可扩容）
>                                                      │
>                                          readRegisterRows（一行 = 一寄存器）
>                                                      ▼
>                                    DataTable（标签只是**视图**）
> ```
> 写方向反过来：草稿（按**窗口身份**分桶）→ 镜像现值回填未编辑行 → `write` → 服务端
> `expandPackedBitWords`（仅位区）→ 设备。

## 核心功能模块

### 1. 连接管理 (`connection-panel.tsx`)
- 支持 Serial/TCP 两种协议（已移除 UDP）
- 支持 ASCII/RTU 两种模式
- 卡片式连接列表，LED 状态指示，hover 显示操作按钮
- 支持广播从站（Slave ID = 0），广播连接仅写操作
- ⭐ R3：新增「设备镜像」分节 —— 4 个区的总寄存器数量（默认 **1000**，下限 1），
  即镜像数组的初始长度；位区附只读位范围 `位 0 ~ N×16−1`
- 底部导入/导出 JSON 配置按钮
- 导入支持覆盖/合并两种策略

### 2. 标签页管理 (`register-tab-manager.tsx`)
- 标签栏：双击重命名，自动生成名称（FCxx @地址）
- 每个标签独立配置：**起始地址、寄存器数量（`registerCount`，寄存器单位）**、功能码、轮询间隔、显示格式
- ⚠️ **字节序不属于标签**（2026-09-20 改绑）：它是**连接**的设备属性，标签侧只读显示 + 「跟随连接」提示。
  改字节序请到**连接配置面板**；改完所有引用该连接的标签立即生效（单一数据源）
- 功能码类型：FunctionCode = '01'|'02'|'03'|'04'|'05'|'06'|'15'|'16'（字符串类型）
- ⭐ 数据表格**四区同构，一行 = 一个寄存器**；位区一行 = 16 个位地址（LED 组），地址列旁附只读 `位 A~B`
- ⭐ **R4 行备注**：表格「地址」列后新增一列，点击行内编辑、空值显示 `—`。
  归属**连接**（= 设备），`key = connectionId:area`、值 = `寄存器序号 -> 文本`，存在 state 顶层 `rowNotes`。
  ⚠️ 用**独立**编辑态（`editingNoteCell` / `noteValue`），**不复用**值编辑的 `editingCell`；备注与"能否写入"无关。
- 数据来源是**该连接的设备镜像**（不是标签自己的缓存）⇒ 同一个物理寄存器在所有标签里值一致
- 写入草稿按**窗口身份**分桶（`registerWindowKey` = `id|功能码|起始地址|寄存器数量`）
  ⇒ 切走再切回还在、不同窗口互不串值
- 写入支持：表格行内编辑 + 写入弹窗双模式；广播写入需确认弹窗
- 越界**不阻止**提交（要保留"主站正确收到并处理 `0x02`"的测试能力）
- 删除连接自动删除关联标签（并**释放该连接的镜像**、按 `connectionId:` 前缀**级联清理行备注**）

### 3. 日志系统 (`log-viewer.tsx`)
- 全局日志数组（500条环形缓冲）
- 按连接筛选展示
- 方向图标（TX/RX/SYS），自动滚动，清除，导出

### 4. 配置持久化 (`use-app-state.tsx`)
- localStorage 自动保存/恢复（连接、标签、激活状态、**行备注 `rowNotes`**）
- 手动 JSON 导入/导出（connections + tabs + **rowNotes**）
- ⚠️ **设备镜像（`registerImages`）不持久化** —— 它是运行时状态，
  恢复配置后按各连接声明的容量**重建**（`HYDRATE` 里做）。
- ⚠️ 迁移**不猜旧字段语义**：旧 `bitCount` 可能是"位数"（差 16 倍），
  一律丢弃回默认值，比搬一个错值安全。

### 5. 国际化 (`use-i18n.tsx` + `i18n.ts`)
- 中文/英文双语支持
- TranslationKey 类型安全

## 页面布局
三栏布局：
- 左侧：连接面板 (w-64)
- 中间：数据区（标签栏 + 配置条 + 数据表格）
- 底部：日志区 (h-56)

## 构建与运行
```bash
pnpm install        # 安装依赖
pnpm run dev        # 开发模式
pnpm run build      # 生产构建
pnpm run start      # 生产启动
pnpm ts-check       # TypeScript 检查
pnpm run lint:build # ESLint（--quiet，只报 error）
pnpm run lint:style # stylelint
pnpm run test       # 单元测试（node:test + tsx）
pnpm run validate   # 上面四项一起跑
```

> ⚠️ `pnpm run build` 会先跑 `pnpm install`；若本机 pnpm store 路径损坏会直接失败
> （与环境有关，与代码无关）。可改用 `pnpm exec next build` 跳过安装来验证编译。

## Docker 容器部署

```bash
docker network create modbus-net 2>/dev/null || true   # 与 modbus-slave 仓库共用，只需建一次
docker compose up -d --build                           # 起本仓库（主站）→ http://localhost:5000
docker compose down
```

> 本仓库的 `docker-compose.yml` 与 [`modbus-slave`](https://github.com/thouen/modbus-slave) 仓库的那份**刻意分开**
> （两个仓库 = 两个独立 compose 项目），靠一张**外部共享网络 `modbus-net`** 互通（两边都写 `external: true`）。
> ⚠️ **必须先起从站、后起主站**，且**不能跨仓库写 `depends_on`**（compose 校验阶段直接报错）。
> 展示时主站界面里的 host 要填 **`modbus-slave`** —— 容器里的 `127.0.0.1` 指向主站自己，连不到从站。
> 完整说明与实测记录见本仓库 `docker-compose.yml` 顶部注释。

## 设计规范
参考 `DESIGN.md`：工业暗色主题，SCADA 监控终端风格。
