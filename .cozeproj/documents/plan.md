# 计划：FC15 批量写优化 + 增加「写入」按钮

## 概述

当前写功能码（05/06/15/16）的行内编辑在单元格失焦/回车时**立即单值写入**，因此配置条（ConfigBar）没有独立的「写入」按钮，FC15/16 也未能发挥批量写多线圈/多寄存器的能力。本次改造为：**行内编辑先暂存为草稿，编辑完成后点击「写入」按钮一次批量提交**；同时修复 FC15 协议层 `values as boolean[]` 的类型断言问题。平台为 Web（Next.js，现有项目功能迭代，不改页面结构，不涉及原型设计）。

## 技术方案

| 维度 | 选择 | 理由 |
|------|------|------|
| 交互模型 | 草稿暂存 + 写入按钮批量提交 | 符合协议批量写语义，替代"即改即写" |
| 草稿状态 | 组件局部 `useState`（Map<address, value>） | 配置不持久化草稿，仅本次会话有效 |
| 批量提交 | 按地址连续区间分组，一次调用对应功能码批量写 | 05/06 单值、15 批量线圈、16 批量寄存器 |
| FC15 修正 | `values.map(v => Boolean(v))` 替代 `as boolean[]` | 显式布尔转换，避免类型断言歧义 |
| 广播 | 批量写前整体走一次确认弹窗 | 复用现有 `broadcastConfirm` 机制 |

## 功能模块

### 1. 数据表格行内编辑（`register-tab-manager.tsx` DataTable）
- 编辑单元格 → 解析值成功后写入**草稿**（`draft: Map<number, number>`），而不是立即发送
- 待写草稿的对应行显示"已修改待写入"样式（高亮/角标）
- 32/64 位只读行不参与编辑（保持现状）

### 2. 配置条「写入」按钮（`register-tab-manager.tsx` ConfigBar）
- 在操作区（读 / 自动轮询旁，L890-923 区域）对写功能码 05/06/15/16 显示「写入」按钮
- **写入即按该标签页全部值提交**：点击「写入」时，取 `startAddress` 起 `quantity` 个值整段下写——被编辑过的行用草稿新值，未编辑的行回填当前原始值，保证 15/16 批量写完整覆盖
- 有未提交草稿时按钮高亮提示，无草稿时置灰
- 按地址连续区间分组，分段批量提交
  - 05/06：单值 `writeCoils`/`writeRegister`（quantity=1）
  - 15：`writeCoils(start, boolean[])` 批量
  - 16：`writeRegisters(start, number[])` 批量
- 广播连接：整批先弹确认，确认后再分段写
- 提交成功清空草稿

### 3. 协议层布尔转换（`modbus-client.ts` writeRegisters）
- `case 0x0f:` 由 `values as boolean[]` 改为 `values.map(v => Boolean(v))`（显式转换）
- `writeRegisters` 入参类型由 `number[] | boolean[]` 统一为 `number[]`（前端始终传 number，布尔转换在函数内做）

## 是否有原型设计

**否**（现有 Web 项目功能迭代，仅交互微调 + 批量逻辑，不新增页面/不改视觉布局）

## 实施步骤

1. 调整写交互为草稿暂存：在 `RegisterTabManager` 增加 `writeDraft` 状态，`commitCellEdit` 改为写入草稿而非立即发送；DataTable 增加草稿行高亮（仅标记已修改，不设数量角标）
2. 新增批量写入逻辑：`commitWriteDraft` 以 `startAddress` 起 `quantity` 个值整段提交（草稿覆盖 + 未编辑行回填原值），按地址连续区间分组后按功能码调用 `writeRegisters`（05/06 单值、15 批量线圈、16 批量寄存器），广播走一次确认
3. 配置条增加「写入」按钮：`ConfigBar` 新增 `onWrite`，写功能码时展示，点击触发整段提交
4. 修复协议层 FC15 布尔转换：`modbus-client.ts` 中 `0x0f` 分支改为 `values.map(Boolean)`，入参统一 `number[]`
5. 补充 i18n key：写入提示相关文案（中英文）
6. 校验：`pnpm ts-check` + `pnpm lint` 通过，接口/逻辑复核