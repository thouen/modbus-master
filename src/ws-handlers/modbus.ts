import { WebSocket, type WebSocketServer } from 'ws';
import {
  connectClient,
  disconnectClient,
  readRegisters,
  writeRegisters,
  toErrorMessage,
} from '../lib/modbus-client';
import type { ConnectionConfig, ModbusConnectionStatus } from '../lib/modbus-types';
import {
  isBroadcastSlave,
  fcToArea,
  isBitArea,
  registerSpanToAddressSpan,
  expandPackedBitWords,
} from '../lib/modbus-types';

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
          type: 'error',
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
    // ⭐ 入参一律是**寄存器单位**（Q19/Q20）；位区的 ×16 换算只在这里做一次。
    case 'read': {
      const { connectionId, tabId, slaveId, functionCode, startAddress, registerCount } = payload as {
        connectionId: string;
        tabId: string;
        slaveId: number;
        functionCode: number;
        /** 寄存器序号（不是位地址） */
        startAddress: number;
        /** 覆盖几个寄存器 */
        registerCount: number;
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
          type: 'error',
          message: `Read error: ${errMsg}`,
        });
        return;
      }

      const area = fcToArea(functionCode);
      if (!area) {
        sendError(ws, connectionId, tabId, `Unsupported read FC: ${functionCode}`);
        return;
      }

      const span = registerSpanToAddressSpan(area, startAddress, registerCount);
      const name = fcName(functionCode);
      // 日志主显示用寄存器编号，位区附只读的位范围（Q20）
      const bitHint = isBitArea(area) ? ` [bit ${span.start}~${span.start + span.count - 1}]` : '';
      const result = await readRegisters(connectionId, slaveId, functionCode, span.start, span.count);

      sendLog(ws, {
        connectionId,
        tabId,
        direction: 'tx',
        message: `${name} Read Reg:${startAddress} Count:${registerCount}${bitHint}`,
      });

      if (result.success && result.data) {
        sendLog(ws, {
          connectionId,
          tabId,
          direction: 'rx',
          message: `${name} Response ${result.data.length} ${isBitArea(area) ? 'bits' : 'regs'} (${result.timing ?? 0}ms)`,
        });
        ws.send(JSON.stringify({
          type: 'data',
          payload: {
            connectionId,
            tabId,
            functionCode,
            // 寄存器单位的落点，前端据此写设备镜像
            startAddress,
            registerCount,
            // 协议原始响应：字区 = 每寄存器一个值；位区 = 每个位一个 0/1
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
          type: 'error',
          message: `Read error: ${result.error}`,
        });
      }
      break;
    }

    // ── 写入操作（支持广播 slave=0）──
    // ⭐ 入参同样是**寄存器单位**：位区 `values` 是**按位打包的寄存器字**，
    // 由这里展开成协议要的「每位一个 0/1」。
    case 'write': {
      const { connectionId, tabId, slaveId, functionCode, startAddress, values } = payload as {
        connectionId: string;
        tabId: string;
        slaveId: number;
        functionCode: number;
        /** 寄存器序号（不是位地址） */
        startAddress: number;
        /** 寄存器单位的值；位区为打包字 */
        values: number[];
      };

      const conn = connectionConfigs.get(connectionId);
      if (!conn) {
        sendError(ws, connectionId, 'Connection not configured');
        return;
      }

      const area = fcToArea(functionCode);
      if (!area) {
        sendError(ws, connectionId, tabId, `Unsupported write FC: ${functionCode}`);
        return;
      }

      const span = registerSpanToAddressSpan(area, startAddress, values.length);
      // 位区：打包字 → 每位一个 0/1（协议口径）
      const onlineValues = isBitArea(area) ? expandPackedBitWords(values, span.count) : values;

      const name = fcName(functionCode);
      const broadcast = isBroadcastSlave(slaveId);
      const result = await writeRegisters(connectionId, slaveId, functionCode, span.start, onlineValues);

      const bitHint = isBitArea(area) ? ` [bit ${span.start}~${span.start + span.count - 1}]` : '';
      sendLog(ws, {
        connectionId,
        tabId,
        direction: 'tx',
        message: `${name} Write Reg:${startAddress} Count:${values.length}${bitHint}${broadcast ? ' [BROADCAST]' : ''}`,
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
          payload: {
            connectionId,
            tabId,
            functionCode,
            startAddress,
            // 回显寄存器单位的值，前端据此把确认过的值落到镜像
            values,
            broadcast,
          },
        }));
      } else {
        sendError(ws, connectionId, tabId, result.error || 'Write failed');
        sendLog(ws, {
          connectionId,
          tabId,
          direction: 'sys',
          type: 'error',
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
    type?: 'info' | 'data' | 'error';
    message: string;
  },
) {
  ws.send(JSON.stringify({
    type: 'log',
    payload: {
      connectionId: payload.connectionId,
      tabId: payload.tabId ?? '',
      direction: payload.direction,
      type: payload.type ?? 'info',
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
