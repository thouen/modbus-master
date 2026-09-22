# DESIGN.md - ModBus Master Web Application

## 气质与意象
工业控制室中的 SCADA 监控终端：深色调背景、等宽字体数据流、琥珀色与翠绿色状态指示灯。
画面感：深夜工厂控制室，工程师面前的多屏监控台，数据在黑色背景上以绿色/琥珀色文字流动。

## 视觉策略
- 深色主题为主，模拟工业 HMI 界面
- 数据密集型布局，信息密度高但层次分明
- 使用等宽字体展示寄存器数据，增强可读性
- 状态指示使用工业标准色：绿色=正常/连接、红色=错误/断开、琥珀色=警告/读写中

## 配色方案

> **唯一基准是代码**：`src/app/globals.css` 的 `:root`。
> 2026-09-18 已把本文件与 **`modbus-slave` 逐 token 对齐**（以 slave 为准）。
> 下表是 token 速查，**不是独立定义** —— 改色只改 CSS，再回来同步本表。
> 两边的 token 集合已用脚本比对确认一致（唯一差异是 slave 多一个未接线的 `--destructive-foreground`，见文末）。

| 用途 | token | 值 |
|---|---|---|
| 页面底色 | `--background` | `#0B1120` |
| 主体文字 | `--foreground` | `#CBD5E1` |
| 卡片 / 浮层 | `--card` / `--popover` | `#131C2E` |
| 主色（按钮 / 交互） | `--primary` | `#3B82F6` |
| 次级面（悬停 / 选中） | `--secondary` / `--accent` | `#1E293B` |
| 弱化面 | `--muted` | `#1E293B` |
| 弱化文字 | `--muted-foreground` | `#64748B` |
| 分隔线 / 输入框 | `--border` / `--input` | `#1E293B` |
| 聚焦环 | `--ring` | `#3B82F6` |
| 成功 | `--success` | `#22C55E` |
| 警告 | `--warning` | `#F59E0B` |
| 数据高亮 | `--data` | `#06B6D4` |
| 错误 | `--destructive` | `#EF4444` |
| 主色容器（选中底色） | `--primary-container` | `rgb(59 130 246 / 15%)` |
| 主色容器前景 | `--on-primary-container` | `#93C5FD` |

**面层级（由暗到亮）**：
`--surface-container-lowest` `#070B14` → `--background` `#0B1120` → `--surface` `#0E1628`
→ `--surface-container`(=card) `#131C2E` → `--surface-container-high` `#1A2438`
→ `--surface-container-highest` `#222E44`

**列表项（连接 / 从站实例卡片）专用**：非选中 `--surface-list` `#0d1117`，悬停 `--surface-list-hover` `#111722`。
⚠️ 这一对**刻意比 `--surface-container` 更暗** —— 选中态的底色是 `bg-primary/[0.06]`（≈`#10192B` 叠在页面底上），
若非选中底色比它还亮，选中看起来就成了"变暗"，高亮反而消失。**两端必须共用同一对 token**（2026-09-22 抽成 token）。

**弹窗底色**：一律用**默认 `bg-background`**（`#0B1120`），业务层**不覆盖** `bg-*`。
⚠️ **不是** `--popover` / `--card`（`#131C2E`），尽管语义上像浮层。
两端 `ui/dialog.tsx` / `ui/alert-dialog.tsx` 已逐字一致；2026-09-22 清掉了 master 原有的 `#141922` 覆盖（3 处）
与广播确认弹窗的 `bg-surface-container` —— 至此**两端硬编码色清零**。

**侧栏**：`--sidebar` 跟随 `--surface` `#0E1628`，其余与主体同源。

**图表序列（`--chart-1..5`）**：`#3B82F6` / `#22C55E` / `#F59E0B` / `#06B6D4` / `#8B5CF6`
> ⚠️ 第 5 条 2026-09-18 由 **红 `#ef4444` 改为紫 `#8B5CF6`**。原因：红在工业界面上与告警/错误状态直接冲突，
> 图表第 5 条序列用红会被误读为故障。以 slave 为准。

**阴影（`--shadow-*-value`）**：card `0 1px 2px 0 rgb(0 0 0 / 30%)` /
float `0 10px 15px -3px rgb(0 0 0 / 40%)` / dialog `0 25px 50px -12px rgb(0 0 0 / 60%)`

## 字体排版
- 等宽数据：`--font-mono` = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`
- 界面文字：`--font-sans` = `PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei` / `system-ui` 栈
- 数据表格紧凑排列，行高适中

## 动效与交互
- 面板切换使用简洁过渡
- 日志滚动平滑，新条目从底部追加
- 滚动条：6px 宽，轨道透明，滑块 `#334155`（悬停 `#475569`）—— 2026-09-18 对齐 slave
- ⚠️ **本项目未实现** `data-flash` 数据闪烁动画与 `.led-*` 发光指示点。
  `modbus-slave/src/app/globals.css` 里有这两组定义，但**两边组件都未引用**，属遗留死代码（见文末整改项）。

## 设计禁忌
- 不要使用圆角过大的卡片（保持工业感）
- 不要使用渐变背景（保持简洁专业）
- 不要使用过于鲜艳的色彩（避免视觉疲劳）
- 不要使用动画过多的效果（工业工具注重效率）

---

## 架构（Architecture）

> 本节补充实现层面的架构事实；视觉规范见上文。跨项目约定与实时契约以工作空间 [`AGENTS.md`](../AGENTS.md:1) 为准。

### 运行时拓扑

```mermaid
flowchart LR
  UI[React UI 三栏布局] -->|ws /ws/modbus| H[ws-handlers/modbus.ts]
  H --> C[lib/modbus-client.ts]
  C -->|TCP 502 或 Serial| DEV[(外部 ModBus 设备 / 第三方从站)]
  subgraph Node 进程 端口 5000
    H
    C
  end
```

浏览器**不直接**打开 TCP / 串口：所有协议动作都由 Node 侧执行，UI 只通过 WebSocket 下发指令。

### 分层

| 层 | 位置 | 职责 |
|---|---|---|
| 视图层 | [`components/`](src/components/register-tab-manager.tsx:1) | 三栏布局：连接面板 / 标签页寄存器表格 / 日志 |
| 状态层 | [`hooks/use-app-state.tsx`](src/hooks/use-app-state.tsx:114) | Context + useReducer；`connections`/`tabs` 持久化到 localStorage，运行态不持久化 |
| 传输层（前端） | [`hooks/use-modbus-ws.ts`](src/hooks/use-modbus-ws.ts:8) + [`lib/ws-client.ts`](src/lib/ws-client.ts:16) | WS 建连、消息 → dispatch、指令下发 |
| 传输层（服务端） | [`ws-handlers/modbus.ts`](src/ws-handlers/modbus.ts:48) | `/ws/modbus` 路由、广播状态/日志、错误回执 |
| 协议层 | [`lib/modbus-client.ts`](src/lib/modbus-client.ts:44) | 基于 `modbus-serial`（TCP / RTU / ASCII / 广播写入） |

### 状态模型

- 服务端 [`connectionConfigs`](src/ws-handlers/modbus.ts:19) 为进程内存态：**进程重启即丢失**。
  服务端**不存寄存器数组** —— 值的缓存全在前端。
- 前端持久化 `connections` + `tabs` + 激活项；`connectionStatus` / `registerImages` / `logs`（500 条环形缓冲）均为运行时状态。
- ⭐ **设备镜像（R3）**：[`registerImages`](src/hooks/use-app-state.tsx:1) 是
  **`Record<connectionId, ConnectionRegisterImage>`** —— 每个连接 4 条 `Uint16Array`
  （位区按位打包，1 字 = 16 个位地址），初始长度 = 该连接声明的 `areaTotalRegisters`，
  **收到超出长度的响应时自动扩容**（见 [`connection-image.ts`](src/lib/connection-image.ts:1)）。
  - 归属是**连接**不是标签 ⇒ 同一个物理寄存器在所有引用该连接的标签里值一致。
  - 标签只按 `startAddress` 去镜像里取值，自己不再存数据。
  - **手动编辑是草稿，不进镜像**；镜像只被"主站读回 / 写入确认 /（R2）生成器"改写。
  - 改 `slaveId` 或改声明容量 ⇒ 该连接的镜像**重建**；删连接 ⇒ **释放**。
- 轮询由 [`usePolling()`](src/components/register-tab-manager.tsx:537) 统一调度：连接为 `connected` 才启动，广播连接禁止轮询。

### 已知限制

- 服务端目前**只把回执发给发起请求的那条 socket**（多 WebSocket 连接时，其它标签页收不到状态与日志）。对齐 slave 的广播模型是既定整改项。
- 页面关闭后设备连接不会被回收（[`ws.on('close')`](src/ws-handlers/modbus.ts:72) 有意保留），刷新会留下僵尸连接与串口句柄。
- 报文原文未采集：[`ModbusResponse.rawTx/rawRx`](src/lib/modbus-types.ts:159) 恒为空串。
- 镜像按连接常驻内存（默认 ≈ 8 KB / 连接），**连接多且声明容量大时占用上升**；
  但目前没有"空闲释放"策略 —— 与上面那条"连接不回收"是同一个待整改方向。

### 主题现状（2026-09-18 对齐后）

- master 的深色 token 已与 `modbus-slave` **逐 token 一致**（以 slave 为基准）。
  核对方式：抽取两边所有 `--*: value` 行 → `sort -u` → `diff`，结果只剩 slave 独有一个未接线的变量（见下）。
- **两边都没有浅色主题**：`<html>` 硬编码 `className="dark"`（[`layout.tsx`](src/app/layout.tsx:15)），
  `next-themes` 已安装但**未接 `ThemeProvider`**（只有 [`ui/sonner.tsx`](src/components/ui/sonner.tsx:10) 调 `useTheme()`，
  拿不到 Provider，实际空转）。master 的 `.dark` 块是 `:root` 的副本；slave **连 `.dark` 块都没有**。
  → "明暗切换"不是"接个 Provider 加个开关"，而是要**从零设计一整套浅色**。
- **结构差异（不影响观感，本次未强改）**：master 用 `@layer base` + `@apply`（含 `outline-ring/50`），
  slave 用等价的纯 CSS 写法，且缺 `outline-ring/50`。
- **待清理的死代码**（建议**两边一起删**，而不是往 master 补齐）：
  - slave 的 `:root` 有 `--destructive-foreground: #FFF`，但两边的 `@theme inline` 都没做
    `--color-destructive-foreground` 桥接，任何组件都用不到。
  - slave 的 `.led-green` / `.led-amber` / `.led-red` / `.led-gray` 与
    `@keyframes data-flash` / `.data-flash`：**两边组件均未引用**（原型期遗留）。
