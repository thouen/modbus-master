'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createWsConnection, type WsMessage } from '@/lib/ws-client';
import { useAppState } from './use-app-state';
import type { ConnectionConfig, ModbusConnectionStatus, LogEntry } from '@/lib/modbus-types';

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
        const { tabId, startAddress, registers } = payload as {
          tabId: string;
          startAddress: number;
          registers: number[];
        };
        const data = registers.map((value, i) => ({
          address: startAddress + i,
          rawValue: value,
        }));
        dispatch({ type: 'SET_REGISTER_DATA', payload: { tabId, data } });
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
  const disconnectDevice = useCallback((connectionId: string) => {
    wsRef.current?.send({
      type: 'disconnect',
      payload: { connectionId },
    });
  }, []);

  // 读取寄存器
  const readRegisters = useCallback((
    connectionId: string,
    tabId: string,
    slaveId: number,
    functionCode: number,
    startAddress: number,
    quantity: number,
  ) => {
    wsRef.current?.send({
      type: 'read',
      payload: {
        connectionId,
        tabId,
        slaveId,
        functionCode,
        startAddress,
        quantity,
      },
    });
  }, []);

  // 写入寄存器
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
