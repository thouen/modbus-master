'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createWsConnection, type WsMessage } from '@/lib/ws-client';
import { useAppState } from './use-app-state';
import type { ConnectionConfig, ModbusConnectionStatus } from '@/lib/modbus-types';

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
        const { connectionId, tabId, registers, rawTx, rawRx, timing } = payload as {
          connectionId: string;
          tabId: string;
          registers: number[];
          rawTx?: string;
          rawRx?: string;
          timing?: number;
        };
        // 更新寄存器数据
        const data = registers.map((value, i) => ({
          address: i,
          rawValue: value,
        }));
        dispatch({ type: 'SET_REGISTER_DATA', payload: { tabId, data } });
        break;
      }
      case 'log': {
        const { connectionId, tabId, direction, message, rawData, timestamp } = payload as {
          connectionId: string;
          tabId?: string;
          direction: 'tx' | 'rx' | 'sys';
          message: string;
          rawData?: string;
          timestamp?: number;
        };
        dispatch({
          type: 'ADD_LOG',
          payload: {
            connectionId,
            log: {
              id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              connectionId,
              tabId: tabId || '',
              direction,
              type: 'info',
              message,
              rawData: rawData || '',
              timestamp: timestamp || Date.now(),
            },
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
            connectionId,
            log: {
              id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              connectionId,
              tabId: tabId || '',
              direction: 'sys',
              type: 'error',
              message: `Error: ${message}`,
              rawData: '',
              timestamp: Date.now(),
            },
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
    mode: 'ascii' | 'rtu',
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
        mode,
      },
    });
  }, []);

  return { connectDevice, disconnectDevice, readRegisters };
}