# AGENTS.md - Modbus Master Station

## 项目概览
基于 Next.js 16 的 Modbus TCP 主站 Web 应用，提供工业级 SCADA 风格的设备监控与操作界面。

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19 + TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **Modbus**: modbus-serial (Modbus TCP)
- **包管理**: pnpm

## 目录结构
```
src/
├── app/
│   ├── api/modbus/          # Modbus API 路由
│   │   ├── connect/         # POST - 连接设备
│   │   ├── disconnect/      # POST - 断开连接
│   │   ├── status/          # GET - 连接状态
│   │   ├── read/            # POST - 读取寄存器 (FC01-04)
│   │   ├── write/           # POST - 写入寄存器 (FC05/06/15/16)
│   │   └── logs/            # GET/DELETE - 操作日志
│   ├── page.tsx             # 主页面
│   ├── layout.tsx           # 根布局
│   └── globals.css          # 全局样式 (工业SCADA主题)
├── components/modbus/       # Modbus UI 组件
│   ├── ConnectionPanel.tsx  # 连接配置面板
│   ├── ReadPanel.tsx        # 读取操作面板 (含轮询)
│   ├── WritePanel.tsx       # 写入操作面板
│   ├── DataDisplay.tsx      # 寄存器数据展示表格
│   ├── LogPanel.tsx         # 操作日志面板
│   └── StatusBar.tsx        # 顶部状态栏
├── lib/
│   ├── modbus-client.ts     # Modbus 客户端单例管理器
│   └── utils.ts             # 通用工具
└── types/
    └── modbus.ts            # Modbus 类型定义
```

## 构建与运行
```bash
pnpm install          # 安装依赖
pnpm run dev          # 开发环境
pnpm run build        # 生产构建
pnpm run start        # 生产启动
pnpm ts-check         # TypeScript 类型检查
pnpm lint             # ESLint 检查
```

## 核心功能
- **连接管理**: TCP 连接配置 (host/port/unitId/timeout)
- **读取操作**: FC01 线圈、FC02 离散输入、FC03 保持寄存器、FC04 输入寄存器
- **写入操作**: FC05 单线圈、FC06 单寄存器、FC15 多线圈、FC16 多寄存器
- **自动轮询**: 可配置间隔的定时读取
- **操作日志**: 完整的操作记录与错误追踪
- **数据展示**: 十进制/十六进制/二进制多格式显示

## 设计规范
- 深色工业 SCADA 主题，参考 DESIGN.md
- 主色调：青绿 (#00d4aa) 用于状态和强调
- 等宽字体用于数据显示
- 状态指示灯使用颜色编码
