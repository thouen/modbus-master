'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createWsConnection, type WsMessage } from '@/lib/ws-client';
import { useAppState } from './use-app-state';
import type { ConnectionConfig, ModbusConnectionStatus, LogEntry } from '@/lib/modbus-types';
import { fcToArea, isBitArea, packBitsToWords } from '@/lib/modbus-types';

export function useModbusWs() {
  const { dispatch } = useAppState();
  const wsRef = useRef<ReturnType<typeof createWsConnection> | null>(null);

  // 处理收到的 WS 消息
  const handleMessage = useCallback((msg: WsMessage) => {
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
  }, [dispatch]);

  // 初始化 WS 连接
  useEffect(() => {
    const ws = createWsConnection({
      path: '/ws/modbus',
      onMessage: handleMessage,
      reconnect: true,
    });
    wsRef.current = ws;
    return () => {
      ws.close();
    };
  }, [handleMessage]);

  // 连接设备
  const connectDevice = useCallback((connectionId: string, config: ConnectionConfig) => {
    wsRef.current?.send({
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
    wsRef.current?.send({
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
    wsRef.current?.send({
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
    wsRef.current?.send({
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
