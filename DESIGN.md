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
- 背景色：深灰黑 `#0a0e14` (控制台底色)
- 面板色：`#141922` (模块容器)
- 边框色：`#1e2733` (分隔线)
- 主文字：`#c5cdd8` (数据文本)
- 主色调：`#3b82f6` 蓝 (操作按钮/交互元素)
- 成功色：`#22c55e` 翠绿 (连接状态/正常数据)
- 警告色：`#f59e0b` 琥珀 (通信中/警告)
- 错误色：`#ef4444` 红 (错误/断开)
- 数据高亮：`#06b6d4` 青 (寄存器数值)

## 字体排版
- 数据展示：JetBrains Mono / Fira Code (等宽字体)
- 界面文字：系统默认无衬线
- 数据表格紧凑排列，行高适中

## 动效与交互
- 数据刷新时轻微闪烁效果（模拟终端更新）
- LED 指示灯使用 CSS 发光效果
- 面板切换使用简洁过渡
- 日志滚动平滑，新条目从底部追加

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
- 前端持久化 `connections` + `tabs` + 激活项；`connectionStatus` / `registerData` / `logs`（500 条环形缓冲）均为运行时状态。
- 轮询由 [`usePolling()`](src/components/register-tab-manager.tsx:537) 统一调度：连接为 `connected` 才启动，广播连接禁止轮询。

### 已知限制

- 服务端目前**只把回执发给发起请求的那条 socket**（多 WebSocket 连接时，其它标签页收不到状态与日志）。对齐 slave 的广播模型是既定整改项。
- 页面关闭后设备连接不会被回收（[`ws.on('close')`](src/ws-handlers/modbus.ts:72) 有意保留），刷新会留下僵尸连接与串口句柄。
- 报文原文未采集：[`ModbusResponse.rawTx/rawRx`](src/lib/modbus-types.ts:159) 恒为空串。
