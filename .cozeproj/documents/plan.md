# 重构计划：使用 modbus-serial 库替换自定义协议实现

## 概述

将自定义 ModBus 协议实现替换为 `modbus-serial` 库，移除 UDP，保留 Serial（RTU/ASCII）和 TCP。新增广播支持（Slave ID = 0）。**软件面向 ModBus 初学者**，注重易用性和可理解性：清晰的操作反馈、直观的日志描述、友好的错误提示。**必须支持中英文双语切换**。配置通过 localStorage 自动保存/恢复，并支持手动导入/导出 JSON。

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
| 配置管理 | localStorage 自动保存/恢复 + 手动导入/导出 JSON | 防抖 500ms，导入弹窗覆盖/合并，按钮在连接面板底部 |
| 国际化 | 保留 `use-i18n.tsx` + `i18n.ts`，中英文切换 | 用户要求 |

## 关键设计决策（已确认）

| 决策点 | 结论 | 说明 |
|--------|------|------|
| 配置持久化 | localStorage 自动保存/恢复 + 手动导入/导出 JSON | 防抖 500ms 保存连接+标签页+激活状态；导入时弹窗选覆盖/合并；导入导出按钮在连接面板底部 |
| 写入交互 | 表格可编辑 + 弹窗两种都支持 | 表格内直接编辑值点写入提交；弹窗支持指定地址+值+格式单点写 |
| 广播行为 | 仅允许写操作，读取/轮询自动禁用 | 广播连接（Slave=0）界面直接禁用读取/轮询按钮，符合协议 |
| 格式与字节序 | 显示格式表格内逐行切换 + 字节序标签级配置 | 贴合原型（每行独立数据类型徽章）；32/64 位解析依赖标签级字节序 |
| 日志保留 | 内存保留最近 500 条，按连接下拉筛选 | 所有连接日志统一保留，按连接筛选查看 |
| 连接与标签页关系 | 保持当前方式：标签页绑定连接 | 每个标签页绑定 connectionId，选中连接卡片不影响标签页显示 |
| 删除连接处理 | 自动删除关联标签页 | 删除连接时其下所有标签页一并清除 |
| 错误提示方式 | Toast 通知（轻量不打断） | 连接失败、通信超时等错误通过 Toast 提示 |
| 写入确认范围 | 仅广播写入需要确认 | 广播无响应无法确认结果，其他写入直接执行 |
| 标签页命名 | 自动生成 + 可手动重命名 | 默认按功能码和地址自动生成（如"FC03 @0"），双击可修改 |

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

**`register-tab-manager.tsx`**：轮询跳过写 FC，广播连接禁用读取/轮询，写操作确认提示，移除 profile 引用。数据表格每行数据类型徽章可点击切换显示格式（UInt16/Int16/Float32/HEX/Binary/LED 等），行内值可编辑（仅写 FC 或广播时启用编辑）。字节序保留在标签配置区。

**`log-viewer.tsx`**：移除 hex dump，显示清晰的格式化日志（方向 + 时间 + 操作描述 + 结果）。内存环形缓冲保留最近 500 条，按连接下拉筛选。

**`profile-manager.tsx`**：删除独立面板组件，改为连接面板底部的导入/导出按钮组。localStorage 防抖 500ms 自动保存（连接+标签页+激活状态），导入时弹窗选择覆盖或合并。

**`i18n.ts` + `use-i18n.tsx`**：保留现有国际化框架，新增/更新所有新增功能的翻译词条（广播、连接卡片、日志筛选等），Header 右上角保留语言切换按钮。

### 5. 配置持久化

```typescript
// use-app-state.tsx 中新增
const STORAGE_KEY = 'modbus-master-config';
const DEBOUNCE_MS = 500;

// 保存范围
interface PersistedConfig {
  connections: ConnectionConfig[];
  tabs: RegisterTab[];
  activeTabId: string | null;
  selectedConnectionId: string | null;
}

// 自动保存：状态变化后防抖 500ms 写入 localStorage
// 启动恢复：组件挂载时从 localStorage 读取并初始化状态
// 导入：读取 JSON 文件 → 弹窗选择覆盖/合并 → 更新状态
// 导出：序列化 PersistedConfig → 下载为 .json 文件
```

- 导入/导出按钮位于连接面板底部
- 导入时弹窗：「覆盖现有配置」或「合并到现有配置」
- 不保存日志数据（日志是临时的）

### 6. 文件变更

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

4. **更新前端组件**：`connection-panel.tsx`、`log-viewer.tsx`、`register-tab-manager.tsx`、`use-app-state.tsx`、`use-modbus-ws.ts`、`i18n.ts`、`page.tsx`。删除 `profile-manager.tsx` 独立面板，改为连接面板底部导入/导出按钮。实现已确认决策：表格行内编辑 + 写入弹窗、广播连接禁用读取/轮询、显示格式逐行切换 + 字节序标签级配置、日志 500 条环形缓冲按连接筛选、删除连接自动清除关联标签页、Toast 错误提示、标签页双击重命名、localStorage 防抖 500ms 自动保存/恢复 + 导入弹窗覆盖/合并。Header 保留语言切换按钮，所有新增 UI 文案同步更新中英文翻译。

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
| 连接卡片-删除 | 点击 | 删除连接并自动清除关联标签页 | — |
| 连接面板-导入 | 点击 | 选择 JSON 文件，弹窗选择覆盖/合并 | 面板底部 |
| 连接面板-导出 | 点击 | 下载当前配置为 JSON 文件 | 面板底部 |
| 导入弹窗-覆盖 | 确认 | 清空现有配置，用导入文件替换 | — |
| 导入弹窗-合并 | 确认 | 追加导入的连接和标签页到现有配置 | — |
| 弹窗-协议 | 选择 | Serial / TCP | 无 UDP |
| 弹窗-模式 | 选择 | RTU / ASCII（仅 Serial） | TCP 时禁用 |
| 弹窗-串口参数 | 填写 | 端口/波特率/数据位/停止位/校验位 | 仅 Serial |
| 弹窗-Slave ID | 填写 | 0~247，0=广播 | 0 时显示广播标识 |
| 标签页-读取 | 点击 | 读取并刷新数据表格 | 广播时禁用 |
| 标签页-自动轮询 | 开关 | 定时读取 | 写 FC/广播时禁用 |
| 标签页-写入 | 点击 | 表格编辑值统一提交 或 弹出写入弹窗 | 仅广播时弹确认提示 |
| 数据行-数据类型徽章 | 点击 | 弹出格式选择（UInt16/Int16/Float32/HEX/Binary 等） | 每行独立 |
| 数据行-值 | 编辑 | 修改寄存器值，点写入提交 | 写 FC/广播时启用 |
| 写入弹窗 | 填写 | 地址 + 值 + 格式，确认发送 | 单点写 |
| 标签页-双击 | 双击标签 | 进入重命名编辑状态 | 默认自动生成名称 |
| 错误提示 | 自动 | Toast 通知（连接失败/通信超时等） | 轻量不打断 |
| 日志筛选 | 下拉 | 全部连接 / 指定连接 | 保留最近 500 条 |
| 日志条目 | 查看 | 方向 + 时间 + 操作描述 + 结果 | 清晰可读 |

## 国际化规则

- **所有 UI 文案必须通过 `useI18n()` 的 `t()` 函数获取**，禁止在组件中硬编码中文或英文字符串
- 翻译词条统一维护在 `src/lib/i18n.ts` 中，新增功能必须同步添加中英文翻译
- Header 右上角保留语言切换入口，切换后全局即时生效
- 日志内容中的操作描述（如"读取 10 个保持寄存器"）也需国际化，通过后端下发翻译 key 或前端根据 locale 翻译
