# 重构计划：使用 modbus-serial 库替换自定义协议实现

## 概述

将自定义 ModBus 协议实现替换为 `modbus-serial` 库，移除 UDP 和配置导出功能，保留 Serial（RTU/ASCII）和 TCP。新增广播支持（Slave ID = 0）。**软件面向 ModBus 初学者**，注重易用性和可理解性：清晰的操作反馈、直观的日志描述、友好的错误提示。**必须支持中英文双语切换**。

**平台**：Web（Next.js 16 + React 19 + TypeScript 5）

## 技术方案

| 维度 | 选择 | 理由 |
|------|------|------|
| ModBus 库 | `modbus-serial` v8.x | 成熟稳定，TCP + Serial RTU/ASCII，Promise API |
| 串口依赖 | `serialport` v13.x | Serial 模式必需 |
| 协议支持 | Serial (RTU/ASCII) + TCP | 用户要求 |
| 广播支持 | Slave ID = 0 | 仅写操作，不等待响应 |
| 日志 | 格式化描述（清晰可读） | 面向初学者，避免 raw hex dump |
| 数据展示 | 保留 `modbus-utils.ts` | 不变 |
| 配置管理 | 移除 profile-manager | 用户要求 |
| 国际化 | 保留 `use-i18n.tsx` + `i18n.ts`，中英文切换 | 用户要求 |

## 功能模块

### 1. 协议层（`modbus-client.ts`，替换 `modbus-tcp.ts`）

```typescript
import ModbusRTU from 'modbus-serial';
const clients = new Map<string, ModbusRTU>();

async function connect(connectionId, config): Promise<void>
async function disconnect(connectionId): Promise<void>
async function readRegisters(connectionId, slaveId, fc, startAddr, quantity): Promise<ModbusResponse>
async function writeRegisters(connectionId, slaveId, fc, startAddr, values): Promise<ModbusResponse>
```

- 库处理帧构建/CRC/响应解析，代码量从 ~1000 行降至 ~150 行
- 广播：`slaveId=0` 时写操作发送后不等待响应
- `ModbusResponse` 包含格式化描述（如 `"Read 10 holding registers from address 0"`）

### 2. 类型层（`modbus-types.ts`）

- `Protocol`: `'serial' | 'tcp'`（移除 udp）
- 新增 `MODBUS_BROADCAST_ADDRESS = 0`、`isBroadcast()`
- `ModbusResponse.rawTx/rawRx` 改为格式化描述字符串

### 3. WebSocket 处理器（`ws-handlers/modbus.ts`）

- 调用 `modbus-client.ts` 统一 API
- 移除 UDP 分支
- 日志发送格式化描述，广播标记 `[BROADCAST]`

### 4. UI 层

**`connection-panel.tsx`**：移除 UDP，串口配置完善（数据位/停止位/校验位），Slave ID 允许 0

**`register-tab-manager.tsx`**：轮询跳过写 FC，广播连接禁用读取/轮询，写操作确认提示，移除 profile 引用

**`log-viewer.tsx`**：移除 hex dump，显示清晰的格式化日志（方向 + 时间 + 操作描述 + 结果）

**`profile-manager.tsx`**：删除

**`i18n.ts` + `use-i18n.tsx`**：保留现有国际化框架，新增/更新所有新增功能的翻译词条（广播、连接卡片、日志筛选等），Header 右上角保留语言切换按钮。

### 5. 文件变更

| 文件 | 操作 |
|------|------|
| `src/lib/modbus-client.ts` | 新建 |
| `src/lib/modbus-tcp.ts` | 删除 |
| `src/lib/modbus-types.ts` | 修改 |
| `src/ws-handlers/modbus.ts` | 重写 |
| `src/components/connection-panel.tsx` | 修改 |
| `src/components/log-viewer.tsx` | 修改 |
| `src/components/register-tab-manager.tsx` | 修改 |
| `src/components/profile-manager.tsx` | 删除 |
| `src/hooks/use-app-state.tsx` | 修改 |
| `src/hooks/use-modbus-ws.ts` | 微调 |
| `src/lib/i18n.ts` | 修改 |
| `src/app/page.tsx` | 修改 |
| `package.json` | 修改 |

## 是否有原型设计

是

## 实施步骤

### 阶段一：原型设计

1. **加载 `design-canvas` 技能**，完成原型设计。重点：连接面板（移除 UDP、串口配置、Slave ID 允许 0）、日志查看器（清晰格式化日志）、移除 profile-manager。完成后提示用户确认。

### 阶段二：代码开发

2. **安装依赖并重建协议层**：`modbus-serial` + `serialport`，新建 `modbus-client.ts`，删除 `modbus-tcp.ts`，更新 `modbus-types.ts`。关键文件：`modbus-client.ts`、`modbus-types.ts`、`package.json`

3. **重写 WebSocket 处理器**：`ws-handlers/modbus.ts`，新 API + 广播 + 格式化日志。

4. **更新前端组件**：`connection-panel.tsx`、`log-viewer.tsx`、`register-tab-manager.tsx`、`use-app-state.tsx`、`use-modbus-ws.ts`、`i18n.ts`、`page.tsx`。删除 `profile-manager.tsx`。Header 保留语言切换按钮，所有新增 UI 文案同步更新中英文翻译。

5. **代码检查与验证**：`pnpm ts-check`、`pnpm lint`。

## 页面规格

##### @nav(web-topbar)
> type: topbar
> platform: web

- @page(/) ModBus Master

##### @page(/) ModBus Master

**核心职责**：ModBus 主站测试工具，管理连接、读写寄存器、查看日志。
**访问路径**：直接访问 `/`。
**布局**：Header（Logo + 标题 + 语言切换）+ 左侧连接面板 + 右侧（标签页 + 配置条 + 数据表格 + 日志面板）。

**交互说明**

| 元素 | 动作 | 响应 | 备注 |
|------|------|------|------|
| 语言切换 | 点击 | 中文 ↔ English 切换 | Header 右上角 |
| + 新连接 | 点击 | 弹出连接配置弹窗 | — |
| 连接卡片-连接/断开 | 点击 | 建立/断开连接 | — |
| 连接卡片-编辑 | 点击 | 弹出编辑弹窗 | — |
| 连接卡片-删除 | 点击 | 删除连接 | — |
| 弹窗-协议 | 选择 | Serial / TCP | 无 UDP |
| 弹窗-模式 | 选择 | RTU / ASCII（仅 Serial） | TCP 时禁用 |
| 弹窗-串口参数 | 填写 | 端口/波特率/数据位/停止位/校验位 | 仅 Serial |
| 弹窗-Slave ID | 填写 | 0~247，0=广播 | 0 时显示广播标识 |
| 标签页-读取 | 点击 | 读取并刷新数据表格 | 广播时禁用 |
| 标签页-自动轮询 | 开关 | 定时读取 | 写 FC/广播时禁用 |
| 标签页-写入 | 点击 | 写入 | 广播时弹确认 |
| 日志条目 | 查看 | 方向 + 时间 + 操作描述 + 结果 | 清晰可读 |

## 国际化规则

- **所有 UI 文案必须通过 `useI18n()` 的 `t()` 函数获取**，禁止在组件中硬编码中文或英文字符串
- 翻译词条统一维护在 `src/lib/i18n.ts` 中，新增功能必须同步添加中英文翻译
- Header 右上角保留语言切换入口，切换后全局即时生效
- 日志内容中的操作描述（如"读取 10 个保持寄存器"）也需国际化，通过后端下发翻译 key 或前端根据 locale 翻译
