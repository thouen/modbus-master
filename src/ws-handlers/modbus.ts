import { WebSocket, type WebSocketServer } from 'ws';
import {
  connectClient,
  disconnectClient,
  readRegisters,
  writeRegisters,
  toErrorMessage,
} from '../lib/modbus-client';
import type { ConnectionConfig, ModbusConnectionStatus } from '../lib/modbus-types';
import { isBroadcastSlave } from '../lib/modbus-types';

interface WsMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

/** 已连接的配置信息 */
const connectionConfigs = new Map<string, {
  config: ConnectionConfig;
  status: ModbusConnectionStatus;
}>();

/** 功能码名称映射 */
const FC_NAMES: Record<number, string> = {
  0x01: 'FC01',
  0x02: 'FC02',
  0x03: 'FC03',
  0x04: 'FC04',
  0x05: 'FC05',
  0x06: 'FC06',
  0x0f: 'FC15',
  0x10: 'FC16',
};

function fcName(fc: number): string {
  return FC_NAMES[fc] ?? `FC${String(fc).padStart(2, '0')}`;
}

/** 获取连接显示地址（TCP host:port / Serial port） */
function getConnTarget(config: ConnectionConfig): string {
  if (config.protocol === 'tcp') {
    return `${config.tcpConfig?.host || ''}:${config.tcpConfig?.port || ''}`;
  }
  return config.serialConfig?.port || '';
}

export function setupModbusHandler(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }));
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', payload: null }));
        return;
      }

      try {
        await handleMessage(ws, msg);
      } catch (err: unknown) {
        const errMsg = toErrorMessage(err);
        ws.send(JSON.stringify({ type: 'error', payload: { message: errMsg } }));
      }
    });

    ws.on('close', () => {
      // 保持设备连接，不清除
    });
  });
}

async function handleMessage(ws: WebSocket, msg: WsMessage) {
  const { type, payload } = msg;

  switch (type) {
    // ── 连接 ──
    case 'connect': {
      const { connectionId, config } = payload as {
        connectionId: string;
        config: ConnectionConfig;
      };
      connectionConfigs.set(connectionId, { config, status: 'connecting' });
      broadcastStatus(ws, connectionId, 'connecting');
      try {
        await connectClient(connectionId, config);
        connectionConfigs.set(connectionId, { config, status: 'connected' });
        broadcastStatus(ws, connectionId, 'connected');
        sendLog(ws, {
          connectionId,
          direction: 'sys',
          message: `Connected to ${config.protocol.toUpperCase()} ${getConnTarget(config)}`,
        });
      } catch (err: unknown) {
        connectionConfigs.set(connectionId, { config, status: 'disconnected' });
        broadcastStatus(ws, connectionId, 'disconnected');
        const errMsg = toErrorMessage(err);
        sendError(ws, connectionId, `Connection failed: ${errMsg}`);
        sendLog(ws, {
          connectionId,
          direction: 'sys',
          message: `Connection failed: ${errMsg}`,
        });
      }
      break;
    }

    // ── 断开 ──
    case 'disconnect': {
      const { connectionId } = payload as { connectionId: string };
      const conn = connectionConfigs.get(connectionId);
      if (conn) {
        await disconnectClient(connectionId);
        connectionConfigs.set(connectionId, { config: conn.config, status: 'disconnected' });
        broadcastStatus(ws, connectionId, 'disconnected');
        sendLog(ws, {
          connectionId,
          direction: 'sys',
          message: `Disconnected from ${conn.config.protocol.toUpperCase()}`,
        });
      }
      break;
    }

    // ── 读取寄存器 ──
    case 'read': {
      const { connectionId, tabId, slaveId, functionCode, startAddress, quantity } = payload as {
        connectionId: string;
        tabId: string;
        slaveId: number;
        functionCode: number;
        startAddress: number;
        quantity: number;
      };

      const conn = connectionConfigs.get(connectionId);
      if (!conn) {
        sendError(ws, connectionId, 'Connection not configured');
        return;
      }

      // 广播地址仅支持写操作
      if (isBroadcastSlave(slaveId)) {
        const errMsg = 'Broadcast (slave 0) does not support read operations';
        sendError(ws, connectionId, tabId, errMsg);
        sendLog(ws, {
          connectionId,
          tabId,
          direction: 'sys',
          message: `Read error: ${errMsg}`,
        });
        return;
      }

      const name = fcName(functionCode);
      const result = await readRegisters(connectionId, slaveId, functionCode, startAddress, quantity);

      sendLog(ws, {
        connectionId,
        tabId,
        direction: 'tx',
        message: `${name} Read Addr:${startAddress} Qty:${quantity}`,
      });

      if (result.success && result.data) {
        sendLog(ws, {
          connectionId,
          tabId,
          direction: 'rx',
          message: `${name} Response ${result.data.length} regs (${result.timing ?? 0}ms)`,
        });
        ws.send(JSON.stringify({
          type: 'data',
          payload: {
            connectionId,
            tabId,
            startAddress,
            registers: result.data,
            timing: result.timing,
          },
        }));
      } else {
        sendError(ws, connectionId, tabId, result.error || 'Read failed');
        sendLog(ws, {
          connectionId,
          tabId,
          direction: 'sys',
          message: `Read error: ${result.error}`,
        });
      }
      break;
    }

    // ── 写入操作（支持广播 slave=0）──
    case 'write': {
      const { connectionId, tabId, slaveId, functionCode, startAddress, values } = payload as {
        connectionId: string;
        tabId: string;
        slaveId: number;
        functionCode: number;
        startAddress: number;
        values: number[] | boolean[];
      };

      const conn = connectionConfigs.get(connectionId);
      if (!conn) {
        sendError(ws, connectionId, 'Connection not configured');
        return;
      }

      const name = fcName(functionCode);
      const broadcast = isBroadcastSlave(slaveId);
      const result = await writeRegisters(connectionId, slaveId, functionCode, startAddress, values);

      const qtyInfo = Array.isArray(values) ? ` Qty:${values.length}` : '';
      sendLog(ws, {
        connectionId,
        tabId,
        direction: 'tx',
        message: `${name} Write Addr:${startAddress}${qtyInfo}${broadcast ? ' [BROADCAST]' : ''}`,
      });

      if (result.success) {
        sendLog(ws, {
          connectionId,
          tabId,
          direction: broadcast ? 'sys' : 'rx',
          message: broadcast
            ? `${name} Broadcast sent (${result.timing ?? 0}ms)`
            : `${name} Write success (${result.timing ?? 0}ms)`,
        });
        ws.send(JSON.stringify({
          type: 'write_ack',
          payload: { connectionId, tabId, functionCode, address: startAddress, broadcast },
        }));
      } else {
        sendError(ws, connectionId, tabId, result.error || 'Write failed');
        sendLog(ws, {
          connectionId,
          tabId,
          direction: 'sys',
          message: `Write error: ${result.error}`,
        });
      }
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', payload: { message: `Unknown message type: ${type}` } }));
  }
}

function broadcastStatus(ws: WebSocket, connectionId: string, status: ModbusConnectionStatus) {
  ws.send(JSON.stringify({
    type: 'status',
    payload: { connectionId, status },
  }));
}

function sendLog(
  ws: WebSocket,
  payload: {
    connectionId: string;
    tabId?: string;
    direction: 'tx' | 'rx' | 'sys';
    message: string;
  },
) {
  ws.send(JSON.stringify({
    type: 'log',
    payload: {
      connectionId: payload.connectionId,
      tabId: payload.tabId ?? '',
      direction: payload.direction,
      message: payload.message,
      timestamp: Date.now(),
    },
  }));
}

function sendError(ws: WebSocket, connectionId: string, tabId?: string, message?: string) {
  ws.send(JSON.stringify({
    type: 'error',
    payload: { connectionId, tabId: tabId ?? '', message: message ?? 'Unknown error' },
  }));
}
