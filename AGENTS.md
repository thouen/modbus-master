# AGENTS.md - ModBus Master Web Application

## 项目概览
ModBus 主站网页应用，支持多协议（Serial/TCP/UDP）、多模式（ASCII/RTU）通信，提供多格式寄存器数据展示、实时日志、标签页管理和配置持久化功能。

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **State**: React Context + useReducer

## 目录结构
```
src/
├── app/
│   ├── layout.tsx              # 根布局（dark theme）
│   ├── page.tsx                # 主页面（AppContent 组合）
│   └── globals.css             # 全局样式（工业暗色主题）
├── components/
│   ├── ui/                     # shadcn/ui 组件库
│   ├── connection-panel.tsx    # 连接管理面板
│   ├── register-tab-manager.tsx # 标签页管理 + 数据展示
│   ├── log-viewer.tsx          # 实时日志查看器
│   └── profile-manager.tsx     # 配置文件保存/加载
├── hooks/
│   ├── use-i18n.tsx            # 国际化 Context
│   └── use-app-state.tsx       # 全局状态管理
└── lib/
    ├── i18n.ts                 # 中英文翻译字典
    ├── modbus-types.ts         # ModBus 协议类型定义
    ├── modbus-utils.ts         # 协议工具函数（CRC16/LRC/帧构建/数据转换）
    └── utils.ts                # 通用工具（cn）
```

## 核心功能模块

### 1. 连接管理 (`connection-panel.tsx`)
- 支持 Serial/TCP/UDP 三种协议
- 支持 ASCII/RTU 两种模式
- 串口配置：端口、波特率、数据位、停止位、校验位
- TCP/UDP 配置：主机、端口
- 连接状态指示（连接/断开/连接中）

### 2. 标签页管理 (`register-tab-manager.tsx`)
- 每个标签独立配置：起始地址、寄存器数量（最大125）、功能码、轮询间隔
- 支持自动轮询和单次读取
- 数据展示格式：LED(1位)、Short/UShort/Hex/Binary(16位)、Long/ULong/Float(32位)、Double(64位)
- 32位字节序：ABCD(DCBA)、BADC、CDAB
- 64位字节序：ABCDEFGH、HGFEDCBA、BADCFEHG、GHEFCDAB

### 3. 日志系统 (`log-viewer.tsx`)
- 每个标签独立日志
- 显示发送/接收方向、时间戳、原始数据
- 支持自动滚动、清除、导出

### 4. 配置管理 (`profile-manager.tsx`)
- 保存/加载连接和标签配置
- 支持 JSON 导入/导出

### 5. 国际化 (`use-i18n.tsx` + `i18n.ts`)
- 中文/英文双语支持
- 通过 Context 全局共享

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
