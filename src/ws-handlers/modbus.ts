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

/**
 * 当前 ws 服务实例。异步事件（对端掉线）发生时手上没有请求方的 `ws`，
 * 而连接状态是**全局**信息，需要广播给所有客户端 —— 所以留一个模块级引用。
 */
let wssRef: WebSocketServer | null = null;

/**
 * 每次发起连接都递增的「代次」，用于作废**已被用户取消的旧连接尝试**的迟到结果。
 *
 * ⚠️ 真实场景：TCP 连一个不可达/不存在的从站主机会挂在 OS 默认超时里（可能一两分钟），
 * 期间 status 一直是 `connecting`。用户此时点「断开」→ 我们作废这一代；若不作废，
 * 那个仍挂着的 `await connectClient(...)` 稍后返回（成功或失败）就会把状态**覆写回去**，
 * 界面于是又跳回 connected/disconnected，与用户的操作打架。
 */
const connectGeneration = new Map<string, number>();

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
  wssRef = wss;
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
      // 本次尝试的代次：期间若用户断开/重连，代次会变，下面的迟到结果直接丢弃
      const generation = (connectGeneration.get(connectionId) ?? 0) + 1;
      connectGeneration.set(connectionId, generation);
      connectionConfigs.set(connectionId, { config, status: 'connecting' });
      broadcastStatus(connectionId, 'connecting');
      try {
        await connectClient(connectionId, config, {
          // ⭐ 对端（从站）掉线：不再傻等 2s 响应超时，立刻把状态改回 disconnected 并广播
          onLost: (reason) => {
            if (connectGeneration.get(connectionId) !== generation) return;
            markDisconnected(connectionId, reason);
          },
        });
        // ⭐ 连接期间用户已经断开/重新发起：把这次多连上的客户端关掉，别留成"野连接"
        if (connectGeneration.get(connectionId) !== generation) {
          await disconnectClient(connectionId);
          return;
        }
        connectionConfigs.set(connectionId, { config, status: 'connected' });
        broadcastStatus(connectionId, 'connected');
        sendLog(ws, {
          connectionId,
          direction: 'sys',
          message: `Connected to ${config.protocol.toUpperCase()} ${getConnTarget(config)}`,
        });
      } catch (err: unknown) {
        // 迟到的失败：用户已经取消了这次尝试 —— 别再改状态、也别再报错
        if (connectGeneration.get(connectionId) !== generation) return;
        connectionConfigs.set(connectionId, { config, status: 'disconnected' });
        broadcastStatus(connectionId, 'disconnected');
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
      // ⭐ 先作废"进行中的连接尝试"：不可达主机的 connect 可能挂很久，用户必须能取消它
      connectGeneration.set(connectionId, (connectGeneration.get(connectionId) ?? 0) + 1);
      await disconnectClient(connectionId);
      // ⭐ **无条件**广播 disconnected —— 即使服务端此前没有这条连接的记录
      // （服务端重启过、或界面与服务端状态错位），否则客户端会永远卡在旧状态、
      // 连「断开」都点不动。`markDisconnected` 幂等，重复调用安全。
      markDisconnected(connectionId);
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

/** 向**所有**已连接的客户端群发一条消息 */
function broadcast(message: { type: string; payload: unknown }) {
  if (!wssRef) return;
  const raw = JSON.stringify(message);
  for (const client of wssRef.clients) {
    // AGENTS §10：`ws.send` 前必须判 readyState 并兜异常 —— 对方刚断开时 send 会抛
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(raw);
    } catch {
      /* 对端已消失，忽略 */
    }
  }
}

/**
 * 广播连接状态。
 *
 * ⚠️ 改前这里只回发给**请求方** socket（ROADMAP/AGENTS 里的已知遗留 P0-1）。
 * 连接状态是**全局**信息 —— 一条 TCP 连接属于整个服务端，不属于某个浏览器；
 * 而且"对端掉线"时服务端手上根本没有请求方 socket。所以必须广播。
 */
function broadcastStatus(connectionId: string, status: ModbusConnectionStatus) {
  broadcast({ type: 'status', payload: { connectionId, status } });
}

/**
 * 把某连接标记为 `disconnected` 并广播。**幂等** —— 会被「用户主动断开」与
 * 「对端掉线」两条路径调用，重复调用不会出问题。
 *
 * @param lostReason 有值 = 对端掉线（日志记 `error`）；省略 = 用户主动断开（记 `info`）
 */
function markDisconnected(connectionId: string, lostReason?: string) {
  const conn = connectionConfigs.get(connectionId);
  if (conn) {
    connectionConfigs.set(connectionId, { config: conn.config, status: 'disconnected' });
  }
  broadcastStatus(connectionId, 'disconnected');
  const target = conn
    ? `${conn.config.protocol.toUpperCase()} ${getConnTarget(conn.config)}`
    : connectionId;
  broadcastLog({
    connectionId,
    direction: 'sys',
    type: lostReason ? 'error' : 'info',
    message: lostReason
      ? `Connection lost: ${target} — ${lostReason}`
      : `Disconnected from ${target}`,
  });
}

/** 日志 payload */
type LogPayload = {
  connectionId: string;
  tabId?: string;
  direction: 'tx' | 'rx' | 'sys';
  type?: 'info' | 'data' | 'error';
  message: string;
};

/** 把日志 payload 补齐成前端要的形状 */
function makeLogMessage(payload: LogPayload) {
  return {
    connectionId: payload.connectionId,
    tabId: payload.tabId ?? '',
    direction: payload.direction,
    type: payload.type ?? 'info',
    message: payload.message,
    timestamp: Date.now(),
  };
}

/** 广播一条日志（用于"连接丢失"这类跟哪个 socket 无关的全局事件） */
function broadcastLog(payload: LogPayload) {
  broadcast({ type: 'log', payload: makeLogMessage(payload) });
}

function sendLog(ws: WebSocket, payload: LogPayload) {
  ws.send(JSON.stringify({
    type: 'log',
    payload: makeLogMessage(payload),
  }));
}

function sendError(ws: WebSocket, connectionId: string, tabId?: string, message?: string) {
  ws.send(JSON.stringify({
    type: 'error',
    payload: { connectionId, tabId: tabId ?? '', message: message ?? 'Unknown error' },
  }));
}
