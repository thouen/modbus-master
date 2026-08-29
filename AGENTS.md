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
    ├── modbus-types.ts         # ModBus 协议类型定义
    ├── modbus-client.ts        # modbus-serial 协议层封装
    ├── modbus-utils.ts         # 工具函数（数据格式化/转换）
    └── utils.ts                # 通用工具（cn）
```

## 核心功能模块

### 1. 连接管理 (`connection-panel.tsx`)
- 支持 Serial/TCP 两种协议（已移除 UDP）
- 支持 ASCII/RTU 两种模式
- 卡片式连接列表，LED 状态指示，hover 显示操作按钮
- 支持广播从站（Slave ID = 0），广播连接仅写操作
- 底部导入/导出 JSON 配置按钮
- 导入支持覆盖/合并两种策略

### 2. 标签页管理 (`register-tab-manager.tsx`)
- 标签栏：双击重命名，自动生成名称（FCxx @地址）
- 每个标签独立配置：起始地址、数量、功能码、轮询间隔、显示格式、字节序
- 功能码类型：FunctionCode = '01'|'02'|'03'|'04'|'05'|'06'|'15'|'16'（字符串类型）
- 数据表格：地址/原始HEX/原始DEC/格式化值/类型，逐行格式切换
- 写入支持：表格行内编辑 + 写入弹窗双模式
- 广播写入需确认弹窗
- 删除连接自动删除关联标签

### 3. 日志系统 (`log-viewer.tsx`)
- 全局日志数组（500条环形缓冲）
- 按连接筛选展示
- 方向图标（TX/RX/SYS），自动滚动，清除，导出

### 4. 配置持久化 (`use-app-state.tsx`)
- localStorage 自动保存/恢复（连接、标签、激活状态）
- 手动 JSON 导入/导出（connections + tabs）

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
pnpm lint           # ESLint 检查
```

## 设计规范
参考 `DESIGN.md`：工业暗色主题，SCADA 监控终端风格。
