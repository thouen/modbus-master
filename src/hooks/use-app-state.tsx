'use client';

import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import type {
  ConnectionConfig,
  ConnectionRegisterImage,
  RegisterArea,
  RegisterTab,
  LogEntry,
  FunctionCode,
  RowNotes,
  ValueSource,
} from '@/lib/modbus-types';
import { rowNotesKey, withAreaTotals } from '@/lib/modbus-types';
import { applyRegistersToImage, cloneImage, createConnectionImage } from '@/lib/connection-image';
import { generateId } from '@/lib/modbus-utils';

/** localStorage 存储键 */
const STORAGE_KEY = 'modbus-master-config';
/** 全局日志环形缓冲上限 */
const MAX_LOG_ENTRIES = 500;

export interface AppState {
  connections: ConnectionConfig[];
  connectionStatus: Record<string, 'connected' | 'disconnected' | 'connecting'>;
  tabs: RegisterTab[];
  activeTabId: string | null;
  /** 当前选中的连接卡片 */
  activeConnectionId: string | null;
  /**
   * 连接设备镜像：`connectionId -> 该连接的 4 条寄存器数组`（R3）。
   *
   * ⭐ 键是**连接**不是标签：同一个物理寄存器在所有引用该连接的标签里
   * 看到的是同一份值；标签只是视图。
   * ⚠️ 这是运行时状态，**不持久化**（重启进程即清空）。
   */
  registerImages: Record<string, ConnectionRegisterImage>;
  /**
   * **行备注**（R4）：`key = connectionId:area` -> `寄存器序号 -> 备注文本`。
   *
   * ⭐ 归属是**连接**（= 那台设备），不是标签：同一台设备的同一个点，
   * 在引用它的所有标签窗口里看到的都是**同一条**备注。
   *
   * ⚠️ 与 `registerImages` 同为"按设备索引"，但**这份要持久化** ——
   * 备注是用户手录的资料，重启后必须还在（镜像是运行时数据，所以不持久化）。
   */
  rowNotes: RowNotes;
  logs: LogEntry[]; // 全局日志（按 connectionId 筛选展示）
}

export type Action =
  | { type: 'ADD_CONNECTION'; payload: ConnectionConfig }
  | { type: 'UPDATE_CONNECTION'; payload: ConnectionConfig }
  | { type: 'DELETE_CONNECTION'; payload: string }
  | { type: 'SET_CONNECTION_STATUS'; payload: { id: string; status: 'connected' | 'disconnected' | 'connecting' } }
  | { type: 'SET_ACTIVE_CONNECTION'; payload: string | null }
  | { type: 'ADD_TAB'; payload: RegisterTab }
  | { type: 'UPDATE_TAB'; payload: RegisterTab }
  | { type: 'DELETE_TAB'; payload: string }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | {
      /**
       * 把一段主站读回的数据写入该连接的设备镜像（R3）。
       *
       * ⭐ 口径统一：`startRegister` 是寄存器序号，`values` 是**每寄存器一个字**
       * （位区的协议响应"每位一个 0/1"由 WS 层先用 `packBitsToWords` 打包）。
       */
      type: 'APPLY_REGISTER_DATA';
      payload: {
        connectionId: string;
        area: RegisterArea;
        startRegister: number;
        values: number[];
        source: ValueSource;
        /** 统一时间戳（由调用方给，保证 reducer 保持纯函数、StrictMode 下可重复调用） */
        now: number;
      };
    }
  | {
      /** 写入成功后把用户确认过的值落到镜像（R3：镜像的三个写方之一） */
      type: 'APPLY_WRITE_ACK';
      payload: {
        connectionId: string;
        area: RegisterArea;
        startRegister: number;
        values: number[];
        now: number;
      };
    }
  | { type: 'RESET_CONNECTION_IMAGE'; payload: string }
  | {
      /**
       * 写一条**行备注**（R4）。
       *
       * ⚠️ `ownerId` 是**设备**（= `connectionId`）；`address` 是**寄存器序号**（Q20）。
       * `note` 去掉首尾空白后为空串 ⇒ 等价于删除该条备注（见 reducer）。
       */
      type: 'SET_ROW_NOTE';
      payload: { ownerId: string; area: RegisterArea; address: number; note: string };
    }
  | {
      /** 删除一条**行备注**（R4） */
      type: 'DELETE_ROW_NOTE';
      payload: { ownerId: string; area: RegisterArea; address: number };
    }
  | { type: 'ADD_LOG'; payload: LogEntry }
  | { type: 'CLEAR_LOGS'; payload?: string } // connectionId，缺省清全部
  | {
      type: 'IMPORT_CONFIG';
      payload: {
        connections: ConnectionConfig[];
        tabs: RegisterTab[];
        /** R4 行备注：导出时一并带上，导入时随策略替换 / 合并 */
        rowNotes?: RowNotes;
        strategy: 'overwrite' | 'merge';
      };
    }
  | { type: 'RESET_ACTIVE' }
  | { type: 'HYDRATE'; payload: AppState };

const initialState: AppState = {
  connections: [],
  connectionStatus: {},
  tabs: [],
  activeTabId: null,
  activeConnectionId: null,
  registerImages: {},
  rowNotes: {},
  logs: [],
};

/**
 * 兼容旧版标签字段的迁移。
 *
 * ⚠️ 旧字段 `bitCount` 的语义**可能是"位数"而不是"寄存器数"**（差 16 倍），
 * 所以**不猜** —— 直接丢弃、回落到默认值（比搬一个错值更安全，见 ROADMAP §3.7）。
 *
 * ⚠️ 旧版本标签上还带 `byteOrder32` / `byteOrder64`。字节序已改归连接（见 `ConnectionConfig`），
 * 这两个字段随本函数**显式构造返回值而自然丢弃** —— 与已废弃的 `writeMode` 同一先例。
 * **绝不要把它们上推回连接**：那会用旧标签里的值覆盖连接上的新值。
 */
export function migrateTab(tab: Partial<RegisterTab> & { bitCount?: number }): RegisterTab {
  // ⚠️ 旧版本把 16 位位视图的类型名写作 `'led'`，现统一更名为 `'bits'`（类型名 + i18n key 同步）。
  // 旧持久化配置里存的就是 `'led'`，必须在此改写 —— 否则会带一个**已废止的联合成员**进入运行时。
  const legacyFormat: string | undefined = tab.displayFormat;
  return {
    id: tab.id ?? generateId(),
    name: tab.name ?? '',
    connectionId: tab.connectionId ?? '',
    startAddress: tab.startAddress ?? 0,
    registerCount: tab.registerCount ?? 10,
    functionCode: (tab.functionCode ?? '03') as FunctionCode,
    pollInterval: tab.pollInterval ?? 1000,
    displayFormat: (legacyFormat === 'led' ? 'bits' : tab.displayFormat) ?? 'hex',
    isPolling: tab.isPolling ?? false,
  };
}

/** 兼容旧版连接缺 4 个区域总量字段（旧配置没存过，补齐默认 1000） */
export function migrateConnection(conn: ConnectionConfig): ConnectionConfig {
  return withAreaTotals(conn);
}

/**
 * **纯函数**：把 localStorage 里的原始字符串解析成 `AppState`。
 *
 * 抽成纯函数是为了**可单测**：持久化往返是"静默丢数据"的高发点 ——
 * 少读一个字段在运行时完全无感（`undefined` 默默地变成默认值），只有重启后
 * 才发现用户录的资料没了。所以这一层必须有测试盯着。
 */
export function parsePersistedState(raw: string | null): AppState {
  if (!raw) return initialState;
  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const connections = (parsed.connections ?? []).map(migrateConnection);
    const tabs = (parsed.tabs ?? []).map(migrateTab);
    return {
      ...initialState,
      connections,
      tabs,
      activeTabId: parsed.activeTabId ?? null,
      activeConnectionId: parsed.activeConnectionId ?? (connections.length > 0 ? connections[0].id : null),
      // 行备注（R4）是用户手录的资料，必须随配置一起恢复
      rowNotes: parsed.rowNotes ?? {},
      // 运行时状态不持久化
      connectionStatus: Object.fromEntries(connections.map(c => [c.id, 'disconnected' as const])),
      registerImages: {},
      logs: [],
    };
  } catch {
    return initialState;
  }
}

/** 从 localStorage 恢复持久化配置 */
function loadPersistedState(): AppState {
  if (typeof window === 'undefined') return initialState;
  return parsePersistedState(localStorage.getItem(STORAGE_KEY));
}

/** 创建默认标签页（自动命名） */
function createDefaultTab(connectionId: string, index: number): RegisterTab {
  return {
    id: generateId(),
    name: `Tab ${index}`,
    connectionId,
    startAddress: 0,
    registerCount: 10,
    functionCode: '03' as FunctionCode,
    pollInterval: 1000,
    displayFormat: 'hex',
    isPolling: false,
  };
}

/**
 * 确保这批连接都有镜像（缺则按配置新建）。
 * 在 HYDRATE / ADD_CONNECTION 后调用 —— 镜像不持久化，所以恢复配置后要重建。
 */
function withImagesEnsured(
  images: Record<string, ConnectionRegisterImage>,
  connections: ConnectionConfig[],
): Record<string, ConnectionRegisterImage> {
  let next = images;
  for (const conn of connections) {
    if (!next[conn.id]) {
      if (next === images) next = { ...images };
      next[conn.id] = createConnectionImage(conn.id, conn);
    }
  }
  return next;
}

/** 单连接版：确保该连接有镜像 */
function withImageFor(
  images: Record<string, ConnectionRegisterImage>,
  conn: ConnectionConfig | undefined,
): Record<string, ConnectionRegisterImage> {
  if (!conn || images[conn.id]) return images;
  return { ...images, [conn.id]: createConnectionImage(conn.id, conn) };
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_CONNECTION': {
      const conn = migrateConnection(action.payload);
      const defaultTab = createDefaultTab(conn.id, 1);
      return {
        ...state,
        connections: [...state.connections, conn],
        connectionStatus: { ...state.connectionStatus, [conn.id]: 'disconnected' },
        activeConnectionId: conn.id,
        tabs: [...state.tabs, defaultTab],
        activeTabId: defaultTab.id,
        registerImages: withImageFor(state.registerImages, conn),
      };
    }
    case 'UPDATE_CONNECTION': {
      const next = migrateConnection(action.payload);
      const prev = state.connections.find(c => c.id === next.id);
      // ⚠️ 改了单元号（slaveId）就换了"另一台设备"：镜像必须清空重建，
      // 否则会继续显示上一台设备的值（ROADMAP §1-R3 边界）。
      const unitChanged = prev ? prev.slaveId !== next.slaveId : false;
      // 改了声明容量 ⇒ 数组初始长度应随之变化；已扩过容的镜像保留现状更安全，
      // 但用户明确缩小声明范围时应重建（否则"越界"判据与实际容量不符）。
      const capacityChanged = prev
        ? prev.coilCount !== next.coilCount
          || prev.discreteInputCount !== next.discreteInputCount
          || prev.holdingRegisterCount !== next.holdingRegisterCount
          || prev.inputRegisterCount !== next.inputRegisterCount
        : false;

      const registerImages = { ...state.registerImages };
      if (unitChanged || capacityChanged) {
        registerImages[next.id] = createConnectionImage(next.id, next);
      }

      return {
        ...state,
        connections: state.connections.map(c => (c.id === next.id ? next : c)),
        registerImages,
      };
    }
    case 'DELETE_CONNECTION': {
      // 自动删除关联标签页
      const remainingTabs = state.tabs.filter(t => t.connectionId !== action.payload);
      // 释放该连接的设备镜像（R3：连接删除时释放）
      const { [action.payload]: _releasedImage, ...registerImages } = state.registerImages;
      // 级联清理该连接的全部行备注（R4）：备注的归属是"设备"，
      // 设备都没了，`connectionId:area` 这些键就再没有主人 —— 留着只是垃圾。
      const rowNotes = Object.fromEntries(
        Object.entries(state.rowNotes).filter(([k]) => !k.startsWith(`${action.payload}:`)),
      );
      return {
        ...state,
        connections: state.connections.filter(c => c.id !== action.payload),
        connectionStatus: Object.fromEntries(
          Object.entries(state.connectionStatus).filter(([k]) => k !== action.payload)
        ),
        tabs: remainingTabs,
        activeTabId: state.activeTabId && remainingTabs.find(t => t.id === state.activeTabId)
          ? state.activeTabId
          : (remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null),
        activeConnectionId: state.activeConnectionId === action.payload
          ? (state.connections.find(c => c.id !== action.payload)?.id ?? null)
          : state.activeConnectionId,
        registerImages,
        rowNotes,
        logs: state.logs.filter(l => l.connectionId !== action.payload),
      };
    }
    case 'SET_CONNECTION_STATUS':
      return {
        ...state,
        connectionStatus: {
          ...state.connectionStatus,
          [action.payload.id]: action.payload.status,
        },
      };
    case 'SET_ACTIVE_CONNECTION':
      return { ...state, activeConnectionId: action.payload };
    case 'ADD_TAB':
      return {
        ...state,
        tabs: [...state.tabs, action.payload],
        activeTabId: action.payload.id,
        activeConnectionId: action.payload.connectionId,
        // 该连接若还没镜像（例如恢复自旧配置），在此补齐
        registerImages: withImageFor(
          state.registerImages,
          state.connections.find(c => c.id === action.payload.connectionId),
        ),
      };
    case 'UPDATE_TAB':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.payload.id ? action.payload : t
        ),
      };
    case 'DELETE_TAB': {
      const newTabs = state.tabs.filter(t => t.id !== action.payload);
      const newActiveId = state.activeTabId === action.payload
        ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
        : state.activeTabId;
      // ⚠️ 不删镜像：镜像的归属是**连接**，标签只是视图。
      // 关掉一个标签不该让另一个引用同一连接的标签看不到值。
      return {
        ...state,
        tabs: newTabs,
        activeTabId: newActiveId,
      };
    }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabId: action.payload };
    case 'APPLY_REGISTER_DATA': {
      const { connectionId, area, startRegister, values, source, now } = action.payload;
      const conn = state.connections.find(c => c.id === connectionId);
      const existing = state.registerImages[connectionId] ?? (conn ? createConnectionImage(connectionId, conn) : null);
      if (!existing) return state;

      // 克隆后再就地改：保证 reducer 是纯的（StrictMode 会重复调用，不能改到旧 state 上）
      const image = cloneImage(existing);
      const { grown, written } = applyRegistersToImage(image, area, startRegister, values, source, now);
      image.version += 1;

      const logs = grown
        ? [...state.logs, {
            id: `grow_${now}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: now,
            connectionId,
            direction: 'sys' as const,
            type: 'info' as const,
            message: `Device image auto-grown: ${area} capacity → ${image.areas[area].length} registers (response reached ${written} @${startRegister})`,
          }].slice(-MAX_LOG_ENTRIES)
        : state.logs;

      return {
        ...state,
        registerImages: { ...state.registerImages, [connectionId]: image },
        logs,
      };
    }
    case 'APPLY_WRITE_ACK': {
      const { connectionId, area, startRegister, values, now } = action.payload;
      const existing = state.registerImages[connectionId];
      if (!existing) return state;
      const image = cloneImage(existing);
      // 写入确认 = 用户明确要求落地的值 ⇒ 来源记为 manual
      applyRegistersToImage(image, area, startRegister, values, 'manual', now);
      image.version += 1;
      return {
        ...state,
        registerImages: { ...state.registerImages, [connectionId]: image },
      };
    }
    case 'RESET_CONNECTION_IMAGE': {
      const conn = state.connections.find(c => c.id === action.payload);
      if (!conn) return state;
      return {
        ...state,
        registerImages: { ...state.registerImages, [action.payload]: createConnectionImage(action.payload, conn) },
      };
    }
    case 'SET_ROW_NOTE': {
      const { ownerId, area, address, note } = action.payload;
      const key = rowNotesKey(ownerId, area);
      const trimmed = note.trim();
      const bucket = state.rowNotes[key];
      const existing = bucket?.[address];

      // 去空白后为空串 ⇒ 等价于清除该条备注（不留一条"看着有、其实是空白"的备注）
      if (trimmed === '') {
        if (!bucket || existing === undefined) return state;
        const rest = { ...bucket };
        delete rest[address];
        const rowNotes = { ...state.rowNotes };
        if (Object.keys(rest).length === 0) delete rowNotes[key]; // 空桶不留在状态里
        else rowNotes[key] = rest;
        return { ...state, rowNotes };
      }

      // 无变化就直接返回原 state：避免无谓的重渲染与一次 localStorage 写入
      if (existing === trimmed) return state;

      return {
        ...state,
        rowNotes: { ...state.rowNotes, [key]: { ...(bucket ?? {}), [address]: trimmed } },
      };
    }
    case 'DELETE_ROW_NOTE': {
      const { ownerId, area, address } = action.payload;
      const key = rowNotesKey(ownerId, area);
      const bucket = state.rowNotes[key];
      if (!bucket || bucket[address] === undefined) return state;
      const rest = { ...bucket };
      delete rest[address];
      const rowNotes = { ...state.rowNotes };
      if (Object.keys(rest).length === 0) delete rowNotes[key];
      else rowNotes[key] = rest;
      return { ...state, rowNotes };
    }
    case 'ADD_LOG': {
      // 全局环形缓冲，保留最近 500 条
      const nextLogs = [...state.logs, action.payload];
      if (nextLogs.length > MAX_LOG_ENTRIES) {
        return { ...state, logs: nextLogs.slice(-MAX_LOG_ENTRIES) };
      }
      return { ...state, logs: nextLogs };
    }
    case 'CLEAR_LOGS':
      return {
        ...state,
        logs: action.payload ? state.logs.filter(l => l.connectionId !== action.payload) : [],
      };
    case 'IMPORT_CONFIG': {
      const { connections: importedConns, tabs: importedTabs, rowNotes: importedNotes, strategy } = action.payload;
      let connections: ConnectionConfig[];
      let tabs: RegisterTab[];
      let rowNotes: RowNotes;
      if (strategy === 'overwrite') {
        connections = importedConns.map(migrateConnection);
        tabs = importedTabs.map(migrateTab);
        // 覆盖：备注整块替换（导出里没有备注字段 ⇒ 视为空）
        rowNotes = importedNotes ?? {};
      } else {
        // 合并：追加新连接和标签页（简单追加，避免 ID 冲突）
        const connIds = new Set(state.connections.map(c => c.id));
        const mergedConns = [...state.connections];
        const idMap: Record<string, string> = {};
        for (const c of importedConns) {
          const migrated = migrateConnection(c);
          if (connIds.has(migrated.id)) {
            const newId = generateId();
            idMap[migrated.id] = newId;
            mergedConns.push({ ...migrated, id: newId });
          } else {
            mergedConns.push(migrated);
          }
        }
        tabs = [
          ...state.tabs,
          ...importedTabs.map(t => migrateTab({
            ...t,
            id: generateId(),
            connectionId: idMap[t.connectionId] ?? t.connectionId,
          })),
        ];
        connections = mergedConns;
        // ⚠️ 行备注的 key 里嵌着 connectionId ⇒ 连接被重新分配 id 时键也得跟着改，
        // 否则导入的备注会挂在"已不存在的连接"上，界面上永远看不到（静默丢失）。
        const remappedNotes: RowNotes = {};
        for (const [key, bucket] of Object.entries(importedNotes ?? {})) {
          const sep = key.indexOf(':');
          const oldOwner = sep >= 0 ? key.slice(0, sep) : key;
          const area = sep >= 0 ? key.slice(sep + 1) : '';
          remappedNotes[`${idMap[oldOwner] ?? oldOwner}:${area}`] = bucket;
        }
        rowNotes = { ...state.rowNotes, ...remappedNotes };
      }
      return {
        ...state,
        connections,
        tabs,
        rowNotes,
        connectionStatus: Object.fromEntries(connections.map(c => [c.id, 'disconnected' as const])),
        activeTabId: tabs.length > 0 ? tabs[0].id : null,
        activeConnectionId: connections.length > 0 ? connections[0].id : null,
        // 镜像按新连接集合重建（导入的配置是"另一台设备"的说明，旧镜像无意义）
        registerImages: withImagesEnsured({}, connections),
        logs: [],
      };
    }
    case 'RESET_ACTIVE':
      return { ...state, activeConnectionId: null, activeTabId: null };
    case 'HYDRATE': {
      // 从 localStorage 恢复的持久化数据，仅在客户端挂载后应用；服务端/首次渲染用 initialState 保持一致。
      // 镜像不持久化 ⇒ 恢复配置后按各连接声明的容量重建。
      const hydrated = action.payload;
      return {
        ...hydrated,
        registerImages: withImagesEnsured(hydrated.registerImages ?? {}, hydrated.connections),
      };
    }
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // 服务端首次渲染与客户端首次渲染均使用 initialState，避免 hydration 不匹配；
  // 持久化数据在客户端挂载后通过 HYDRATE action 恢复。
  const [state, dispatch] = useReducer(appReducer, initialState);

  // 客户端挂载后从 localStorage 恢复持久化配置
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persisted = loadPersistedState();
    dispatch({ type: 'HYDRATE', payload: persisted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防抖 500ms 自动保存配置到 localStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          connections: state.connections,
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          activeConnectionId: state.activeConnectionId,
          rowNotes: state.rowNotes,
        }));
      } catch {
        /* storage 不可用时静默忽略 */
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [state.connections, state.tabs, state.activeTabId, state.activeConnectionId, state.rowNotes]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context;
}

export { generateId };
