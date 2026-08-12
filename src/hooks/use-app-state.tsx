'use client';

import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type {
  ConnectionConfig,
  RegisterTab,
  RegisterData,
  LogEntry,
  SavedProfile,
  ByteOrder32,
  ByteOrder64,
  FunctionCode,
} from '@/lib/modbus-types';
import { generateId } from '@/lib/modbus-utils';

interface AppState {
  connections: ConnectionConfig[];
  connectionStatus: Record<string, 'connected' | 'disconnected' | 'connecting'>;
  tabs: RegisterTab[];
  activeTabId: string | null;
  registerData: Record<string, RegisterData[]>; // tabId -> data
  logs: Record<string, LogEntry[]>; // connectionId -> logs (merged per connection)
  profiles: SavedProfile[];
  showConnectionPanel: boolean;
  editingConnection: ConnectionConfig | null;
  /** Global default byte order for new connections */
  globalByteOrder32: ByteOrder32;
  globalByteOrder64: ByteOrder64;
}

export type Action =
  | { type: 'ADD_CONNECTION'; payload: ConnectionConfig }
  | { type: 'UPDATE_CONNECTION'; payload: ConnectionConfig }
  | { type: 'DELETE_CONNECTION'; payload: string }
  | { type: 'SET_CONNECTION_STATUS'; payload: { id: string; status: 'connected' | 'disconnected' | 'connecting' } }
  | { type: 'ADD_TAB'; payload: RegisterTab }
  | { type: 'UPDATE_TAB'; payload: RegisterTab }
  | { type: 'DELETE_TAB'; payload: string }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'SET_REGISTER_DATA'; payload: { tabId: string; data: RegisterData[] } }
  | { type: 'ADD_LOG'; payload: { connectionId: string; log: LogEntry } }
  | { type: 'CLEAR_LOGS'; payload: string } // connectionId
  | { type: 'SAVE_PROFILE'; payload: SavedProfile }
  | { type: 'LOAD_PROFILE'; payload: SavedProfile }
  | { type: 'DELETE_PROFILE'; payload: string }
  | { type: 'TOGGLE_CONNECTION_PANEL'; payload?: boolean }
  | { type: 'SET_EDITING_CONNECTION'; payload: ConnectionConfig | null }
  | { type: 'SET_GLOBAL_BYTE_ORDER'; payload: { type: '32' | '64'; order: ByteOrder32 | ByteOrder64 } };

const initialState: AppState = {
  connections: [],
  connectionStatus: {},
  tabs: [],
  activeTabId: null,
  registerData: {},
  logs: {},
  profiles: [],
  showConnectionPanel: false,
  editingConnection: null,
  globalByteOrder32: 'ABCD',
  globalByteOrder64: 'ABCDEFGH',
};

/** Create a default tab for a given connection */
function createDefaultTab(connectionId: string, tabIndex: number, conn: ConnectionConfig): RegisterTab {
  return {
    id: generateId(),
    name: `Reg ${tabIndex}`,
    connectionId,
    startAddress: 0,
    bitCount: 160,
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
      // Auto-create a default tab for the new connection
      const tabIndex = state.tabs.filter(t => t.connectionId === action.payload.id).length + 1;
      const defaultTab = createDefaultTab(action.payload.id, tabIndex, action.payload);
      return {
        ...state,
        connections: [...state.connections, action.payload],
        connectionStatus: { ...state.connectionStatus, [action.payload.id]: 'disconnected' },
        logs: { ...state.logs, [action.payload.id]: [] },
        tabs: [...state.tabs, defaultTab],
        activeTabId: state.activeTabId ?? defaultTab.id,
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
      const { [action.payload]: _removedLogs, ...remainingLogs } = state.logs;
      const remainingTabs = state.tabs.filter(t => t.connectionId !== action.payload);
      const newActiveId = state.activeTabId && state.tabs.find(t => t.id === state.activeTabId)?.connectionId === action.payload
        ? (remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null)
        : state.activeTabId;
      return {
        ...state,
        connections: state.connections.filter(c => c.id !== action.payload),
        connectionStatus: Object.fromEntries(
          Object.entries(state.connectionStatus).filter(([k]) => k !== action.payload)
        ),
        logs: remainingLogs,
        tabs: remainingTabs,
        activeTabId: newActiveId,
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
    case 'ADD_TAB':
      return {
        ...state,
        tabs: [...state.tabs, action.payload],
        activeTabId: state.activeTabId ?? action.payload.id,
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
    case 'ADD_LOG':
      return {
        ...state,
        logs: {
          ...state.logs,
          [action.payload.connectionId]: [
            ...(state.logs[action.payload.connectionId] ?? []),
            action.payload.log,
          ].slice(-1000), // keep last 1000 entries per connection
        },
      };
    case 'CLEAR_LOGS':
      return {
        ...state,
        logs: { ...state.logs, [action.payload]: [] },
      };
    case 'SAVE_PROFILE':
      return {
        ...state,
        profiles: [...state.profiles.filter(p => p.id !== action.payload.id), action.payload],
      };
    case 'LOAD_PROFILE': {
      const profile = action.payload;
      return {
        ...state,
        connections: profile.connections,
        tabs: profile.tabs,
        activeTabId: profile.tabs.length > 0 ? profile.tabs[0].id : null,
        connectionStatus: Object.fromEntries(
          profile.connections.map(c => [c.id, 'disconnected' as const])
        ),
        logs: Object.fromEntries(
          profile.connections.map(c => [c.id, []])
        ),
      };
    }
    case 'DELETE_PROFILE':
      return {
        ...state,
        profiles: state.profiles.filter(p => p.id !== action.payload),
      };
    case 'TOGGLE_CONNECTION_PANEL':
      return {
        ...state,
        showConnectionPanel: action.payload ?? !state.showConnectionPanel,
      };
    case 'SET_EDITING_CONNECTION':
      return { ...state, editingConnection: action.payload };
    case 'SET_GLOBAL_BYTE_ORDER':
      if (action.payload.type === '32') {
        return { ...state, globalByteOrder32: action.payload.order as ByteOrder32 };
      }
      return { ...state, globalByteOrder64: action.payload.order as ByteOrder64 };
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
  const [state, dispatch] = useReducer(appReducer, initialState);
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