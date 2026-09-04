'use client';

import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import type {
  ConnectionConfig,
  RegisterTab,
  RegisterData,
  LogEntry,
  FunctionCode,
} from '@/lib/modbus-types';
import { generateId } from '@/lib/modbus-utils';

/** localStorage 存储键 */
const STORAGE_KEY = 'modbus-master-config';
/** 全局日志环形缓冲上限 */
const MAX_LOG_ENTRIES = 500;

interface AppState {
  connections: ConnectionConfig[];
  connectionStatus: Record<string, 'connected' | 'disconnected' | 'connecting'>;
  tabs: RegisterTab[];
  activeTabId: string | null;
  /** 当前选中的连接卡片 */
  activeConnectionId: string | null;
  registerData: Record<string, RegisterData[]>; // tabId -> data
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
  | { type: 'SET_REGISTER_DATA'; payload: { tabId: string; data: RegisterData[] } }
  | { type: 'ADD_LOG'; payload: LogEntry }
  | { type: 'CLEAR_LOGS'; payload?: string } // connectionId，缺省清全部
  | { type: 'IMPORT_CONFIG'; payload: { connections: ConnectionConfig[]; tabs: RegisterTab[]; strategy: 'overwrite' | 'merge' } }
  | { type: 'RESET_ACTIVE' }
  | { type: 'HYDRATE'; payload: AppState };

const initialState: AppState = {
  connections: [],
  connectionStatus: {},
  tabs: [],
  activeTabId: null,
  activeConnectionId: null,
  registerData: {},
  logs: [],
};

/** 兼容旧版字段 bitCount -> quantity 的标签迁移 */
function migrateTab(tab: Partial<RegisterTab> & { bitCount?: number }): RegisterTab {
  return {
    id: tab.id ?? generateId(),
    name: tab.name ?? '',
    connectionId: tab.connectionId ?? '',
    startAddress: tab.startAddress ?? 0,
    quantity: tab.quantity ?? tab.bitCount ?? 10,
    functionCode: (tab.functionCode ?? '03') as FunctionCode,
    pollInterval: tab.pollInterval ?? 1000,
    displayFormat: tab.displayFormat ?? 'hex',
    byteOrder32: tab.byteOrder32 ?? 'ABCD',
    byteOrder64: tab.byteOrder64 ?? 'ABCDEFGH',
    isPolling: tab.isPolling ?? false,
  };
}

/** 从 localStorage 恢复持久化配置 */
function loadPersistedState(): AppState {
  if (typeof window === 'undefined') return initialState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const connections = parsed.connections ?? [];
    return {
      ...initialState,
      connections,
      tabs: (parsed.tabs ?? []).map(migrateTab),
      activeTabId: parsed.activeTabId ?? null,
      activeConnectionId: parsed.activeConnectionId ?? (connections.length > 0 ? connections[0].id : null),
      // 运行时状态不持久化
      connectionStatus: Object.fromEntries(connections.map(c => [c.id, 'disconnected' as const])),
      registerData: {},
      logs: [],
    };
  } catch {
    return initialState;
  }
}

/** 创建默认标签页（自动命名） */
function createDefaultTab(connectionId: string, conn: ConnectionConfig, index: number): RegisterTab {
  return {
    id: generateId(),
    name: `Tab ${index}`,
    connectionId,
    startAddress: 0,
    quantity: 10,
    functionCode: '03' as FunctionCode,
    pollInterval: 1000,
    displayFormat: 'hex',
    byteOrder32: conn.byteOrder32,
    byteOrder64: conn.byteOrder64,
    isPolling: false,
  };
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_CONNECTION': {
      const defaultTab = createDefaultTab(action.payload.id, action.payload, 1);
      return {
        ...state,
        connections: [...state.connections, action.payload],
        connectionStatus: { ...state.connectionStatus, [action.payload.id]: 'disconnected' },
        activeConnectionId: action.payload.id,
        tabs: [...state.tabs, defaultTab],
        activeTabId: defaultTab.id,
      };
    }
    case 'UPDATE_CONNECTION':
      return {
        ...state,
        connections: state.connections.map(c =>
          c.id === action.payload.id ? action.payload : c
        ),
      };
    case 'DELETE_CONNECTION': {
      // 自动删除关联标签页
      const remainingTabs = state.tabs.filter(t => t.connectionId !== action.payload);
      const removedTabIds = new Set(
        state.tabs.filter(t => t.connectionId === action.payload).map(t => t.id)
      );
      const registerData = Object.fromEntries(
        Object.entries(state.registerData).filter(([tabId]) => !removedTabIds.has(tabId))
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
        registerData,
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
      const { [action.payload]: _removedData, ...remainingData } = state.registerData;
      return {
        ...state,
        tabs: newTabs,
        activeTabId: newActiveId,
        registerData: remainingData,
      };
    }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabId: action.payload };
    case 'SET_REGISTER_DATA':
      return {
        ...state,
        registerData: { ...state.registerData, [action.payload.tabId]: action.payload.data },
      };
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
      const { connections: importedConns, tabs: importedTabs, strategy } = action.payload;
      let connections: ConnectionConfig[];
      let tabs: RegisterTab[];
      if (strategy === 'overwrite') {
        connections = importedConns;
        tabs = importedTabs.map(migrateTab);
      } else {
        // 合并：追加新连接和标签页（简单追加，避免 ID 冲突）
        const connIds = new Set(state.connections.map(c => c.id));
        const mergedConns = [...state.connections];
        const idMap: Record<string, string> = {};
        for (const c of importedConns) {
          if (connIds.has(c.id)) {
            const newId = generateId();
            idMap[c.id] = newId;
            mergedConns.push({ ...c, id: newId });
          } else {
            mergedConns.push(c);
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
      }
      return {
        ...state,
        connections,
        tabs,
        connectionStatus: Object.fromEntries(connections.map(c => [c.id, 'disconnected' as const])),
        activeTabId: tabs.length > 0 ? tabs[0].id : null,
        activeConnectionId: connections.length > 0 ? connections[0].id : null,
        registerData: {},
        logs: [],
      };
    }
    case 'RESET_ACTIVE':
      return { ...state, activeConnectionId: null, activeTabId: null };
    case 'HYDRATE':
      // 从 localStorage 恢复的持久化数据，仅在客户端挂载后应用；服务端/首次渲染用 initialState 保持一致
      return action.payload;
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
        }));
      } catch {
        /* storage 不可用时静默忽略 */
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [state.connections, state.tabs, state.activeTabId, state.activeConnectionId]);

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
