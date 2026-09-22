'use client';

import { useEffect, useCallback, type Dispatch } from 'react';
import { createWsConnection, type WsMessage } from '@/lib/ws-client';
import { useAppState, type Action } from './use-app-state';
import type { ConnectionConfig, ModbusConnectionStatus, LogEntry } from '@/lib/modbus-types';
import { fcToArea, isBitArea, packBitsToWords } from '@/lib/modbus-types';

/**
 * 服务端推送消息 → store 的分发。
 *
 * ⚠️ 收口成**模块级纯函数**（接收 dispatch 作为参数），而不是每组件一份 useCallback：
 * 同一帧消息只能被处理一次，否则广播类消息会被重复入账（见下方单例说明）。
 */
function routeMessage(dispatch: Dispatch<Action>, msg: WsMessage) {
  const { type, payload } = msg;

  switch (type) {
    case 'status': {
      const { connectionId, status } = payload as {
        connectionId: string;
        status: ModbusConnectionStatus;
      };
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: { id: connectionId, status } });
      break;
    }
    case 'data': {
      // ⭐ 服务端回传的是**寄存器单位**的落点 + 协议原始响应。
      const { connectionId, functionCode, startAddress, registers } = payload as {
        connectionId: string;
        tabId: string;
        functionCode: number;
        /** 寄存器序号 */
        startAddress: number;
        registerCount: number;
        /** 字区：每寄存器一个值；位区：每位一个 0/1 */
        registers: number[];
      };
      const area = fcToArea(functionCode);
      if (!area) break;
      // 位区响应是"每位一个 0/1"，先打包成寄存器字 —— 镜像只认寄存器单位
      const words = isBitArea(area) ? packBitsToWords(registers) : registers;
      dispatch({
        type: 'APPLY_REGISTER_DATA',
        payload: {
          connectionId,
          area,
          startRegister: startAddress,
          values: words,
          source: 'master',
          now: Date.now(),
        },
      });
      break;
    }
    case 'write_ack': {
      // 写入成功确认：把用户确认过的值落到镜像（镜像的三个写方之一）
      const { connectionId, functionCode, startAddress, values } = payload as {
        connectionId: string;
        tabId: string;
        functionCode: number;
        /** 寄存器序号 */
        startAddress: number;
        /** 寄存器单位的值（位区为打包字） */
        values: number[];
        broadcast?: boolean;
      };
      const area = fcToArea(functionCode);
      if (!area) break;
      dispatch({
        type: 'APPLY_WRITE_ACK',
        payload: { connectionId, area, startRegister: startAddress, values, now: Date.now() },
      });
      break;
    }
    case 'log': {
      const { connectionId, tabId, direction, message, rawData, timestamp, type: logType } = payload as {
        connectionId: string;
        tabId?: string;
        direction: LogEntry['direction'];
        message: string;
        rawData?: string;
        timestamp?: number;
        type?: LogEntry['type'];
      };
      dispatch({
        type: 'ADD_LOG',
        payload: {
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          connectionId,
          tabId: tabId || '',
          direction,
          type: logType || (direction === 'sys' ? 'error' : 'info'),
          message,
          rawData: rawData || '',
          timestamp: timestamp || Date.now(),
        },
      });
      break;
    }
    case 'error': {
      const { connectionId, tabId, message } = payload as {
        connectionId: string;
        tabId?: string;
        message: string;
      };
      dispatch({
        type: 'ADD_LOG',
        payload: {
          id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          connectionId,
          tabId: tabId || '',
          direction: 'sys',
          type: 'error',
          message: `Error: ${message}`,
          rawData: '',
          timestamp: Date.now(),
        },
      });
      break;
    }
  }
}

// ── 全应用唯一的 WS 连接（引用计数式订阅）─────────────────────────
//
// ⚠️ **为什么必须是单例** —— 这是一条踩实了的坑：
//   本 Hook 目前被 5 处组件调用（ConnectionPanel / ConnectionDialog /
//   DeleteConfirmDialog / RegisterTabManager / usePolling）。
//   改造前每个调用点各自 `createWsConnection()` ⇒ 浏览器里同时挂着 **5 条** WS。
//   服务端**广播**（broadcast）一条日志时会发给全部 5 条，5 份都落到**同一个** store，
//   `ADD_LOG` 被 dispatch 5 次 ⇒ 日志面板出现 5 条一字不差的记录
//   （典型触发：断开连接 —— 服务端走 `markDisconnected` → `broadcastLog`）。
//   而「连接成功」「FC 读写」用的是**单发**（`sendLog(ws, …)`）只回给请求方，所以那些不重复。
//   ⇒ 现象就是"只有断开时日志成倍"。修法是让 5 处共享一条连接（与 slave 侧
//   `slave-ws-manager` 同一套思路），而不是让每处各自收敛。

interface Sink {
  conn: ReturnType<typeof createWsConnection>;
  dispatch: Dispatch<Action>;
  refCount: number;
}

let sink: Sink | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 末位退订后的关闭宽限期。
 * ⚠️ 直接用"refCount 归零就 close"会在 StrictMode 的 mount→unmount→mount
 * 以及 HMR 下反复断开重连，所以留一个宽限期，期间有人重新订阅就撤销关闭。
 */
const IDLE_CLOSE_GRACE_MS = 1000;

function acquireSink(dispatch: Dispatch<Action>) {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
  if (sink) {
    // dispatch 来自 useReducer，引用稳定；这里赋值是为了不依赖该前提
    sink.dispatch = dispatch;
    sink.refCount += 1;
    return;
  }
  const conn = createWsConnection({
    path: '/ws/modbus',
    // 闭包只持有 sink，不持有 dispatch：避免旧连接的 onmessage 打到过期 store
    onMessage: (msg) => {
      if (sink) routeMessage(sink.dispatch, msg);
    },
    reconnect: true,
  });
  sink = { conn, dispatch, refCount: 1 };
}

function releaseSink() {
  if (!sink) return;
  sink.refCount -= 1;
  if (sink.refCount > 0) return;
  if (idleCloseTimer) clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null;
    // 宽限期内又有人订阅 ⇒ 什么都不做
    if (!sink || sink.refCount > 0) return;
    sink.conn.close();
    sink = null;
  }, IDLE_CLOSE_GRACE_MS);
}

/** 发送一条消息到服务端（未建连时静默丢弃，与原 `wsRef.current?.send` 语义一致） */
function sendToServer(msg: WsMessage) {
  sink?.conn.send(msg);
}

export function useModbusWs() {
  const { dispatch } = useAppState();

  // 引用计数式注册：多少个组件调用本 Hook，都只共享一条 WS。
  useEffect(() => {
    acquireSink(dispatch);
    return releaseSink;
  }, [dispatch]);

  // 连接设备
  const connectDevice = useCallback((connectionId: string, config: ConnectionConfig) => {
    sendToServer({
      type: 'connect',
      payload: { connectionId, config },
    });
    dispatch({ type: 'SET_CONNECTION_STATUS', payload: { id: connectionId, status: 'connecting' } });
  }, [dispatch]);

  // 断开设备
  // ⭐ **乐观更新**：立刻把本地状态置为 `disconnected`，不等服务端回包。
  // 理由：如果服务端此前没有这条连接的记录（服务端重启过、或这次连接尝试还挂在
  // `connecting` 中），它本来就不会回状态，界面会一直卡在旧状态。服务端随后的
  // `status` 广播仍会再校正一次，所以乐观置位是安全的。
  const disconnectDevice = useCallback((connectionId: string) => {
    sendToServer({
      type: 'disconnect',
      payload: { connectionId },
    });
    dispatch({ type: 'SET_CONNECTION_STATUS', payload: { id: connectionId, status: 'disconnected' } });
  }, [dispatch]);

  /**
   * 读取寄存器。
   * ⭐ `startAddress` 是**寄存器序号**、`registerCount` 是**寄存器个数** ——
   * 位区的 ×16 换算由服务端统一做（唯一一处），前端不碰协议地址。
   */
  const readRegisters = useCallback((
    connectionId: string,
    tabId: string,
    slaveId: number,
    functionCode: number,
    startAddress: number,
    registerCount: number,
  ) => {
    sendToServer({
      type: 'read',
      payload: {
        connectionId,
        tabId,
        slaveId,
        functionCode,
        startAddress,
        registerCount,
      },
    });
  }, []);

  /**
   * 写入寄存器。
   * ⭐ `startAddress` 是寄存器序号；`values` 是**寄存器单位**（位区为按位打包的字），
   * 位区展开成"每位一个 0/1"同样由服务端负责。
   */
  const writeRegisters = useCallback((
    connectionId: string,
    tabId: string,
    slaveId: number,
    functionCode: number,
    startAddress: number,
    values: number[],
  ) => {
    sendToServer({
      type: 'write',
      payload: {
        connectionId,
        tabId,
        slaveId,
        functionCode,
        startAddress,
        values,
      },
    });
  }, []);

  return { connectDevice, disconnectDevice, readRegisters, writeRegisters };
}
