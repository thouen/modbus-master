import { WebSocket, type WebSocketServer } from 'ws';
import {
  connectTcp,
  disconnectTcp,
  readTcpRegisters,
  connectUdp,
  disconnectUdp,
  readUdpRegisters,
  connectSerial,
  disconnectSerial,
  readSerialRegisters,
  writeSingleCoil,
  writeSingleRegister,
  writeMultipleCoils,
  writeMultipleRegisters,
  disconnectAll,
} from '../lib/modbus-tcp';
import type { ConnectionConfig, ModbusConnectionStatus } from '../lib/modbus-types';

interface WsMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

// 存储已连接的配置信息
const connectionConfigs = new Map<string, {
  config: ConnectionConfig;
  status: ModbusConnectionStatus;
}>();

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
        const errMsg = err instanceof Error ? err.message : String(err);
        ws.send(JSON.stringify({ type: 'error', payload: { message: errMsg } }));
      }
    });

    ws.on('close', () => {
      // 不清除连接，保持设备连接
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

      try {
        connectionConfigs.set(connectionId, { config, status: 'connecting' });
        broadcastStatus(ws, connectionId, 'connecting');

        const protocol = config.protocol;

        if (protocol === 'tcp') {
          await connectTcp(connectionId, config.tcpConfig?.host || '127.0.0.1', config.tcpConfig?.port || 502);
        } else if (protocol === 'udp') {
          await connectUdp(connectionId, config.udpConfig?.host || '127.0.0.1', config.udpConfig?.port || 502);
        } else if (protocol === 'serial') {
          await connectSerial(
            connectionId,
            config.serialConfig?.port || '/dev/ttyUSB0',
            config.serialConfig?.baudRate || 9600,
            config.serialConfig?.dataBits || 8,
            config.serialConfig?.stopBits || 1,
            config.serialConfig?.parity || 'none',
          );
        }

        connectionConfigs.set(connectionId, { config, status: 'connected' });
        broadcastStatus(ws, connectionId, 'connected');
        const hostInfo = protocol === 'tcp' || protocol === 'udp'
          ? `${(config.tcpConfig || config.udpConfig)?.host || ''}:${(config.tcpConfig || config.udpConfig)?.port || ''}`
          : config.serialConfig?.port || '';
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId,
            direction: 'sys',
            message: `Connected to ${protocol.toUpperCase()} ${hostInfo}`,
            rawData: '',
            timestamp: Date.now(),
          },
        }));
      } catch (err: unknown) {
        connectionConfigs.set(connectionId, { config, status: 'disconnected' });
        const errMsg = err instanceof Error ? err.message : String(err);
        broadcastStatus(ws, connectionId, 'disconnected');
        ws.send(JSON.stringify({
          type: 'error',
          payload: { connectionId, message: `Connection failed: ${errMsg}` },
        }));
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId,
            direction: 'sys',
            message: `Connection failed: ${errMsg}`,
            rawData: '',
            timestamp: Date.now(),
          },
        }));
      }
      break;
    }

    // ── 断开 ──
    case 'disconnect': {
      const { connectionId } = payload as { connectionId: string };
      const conn = connectionConfigs.get(connectionId);
      if (conn) {
        const { config } = conn;
        const protocol = config.protocol;
        if (protocol === 'tcp') await disconnectTcp(connectionId);
        else if (protocol === 'udp') await disconnectUdp(connectionId);
        else if (protocol === 'serial') await disconnectSerial(connectionId);
        connectionConfigs.set(connectionId, { config, status: 'disconnected' });
        broadcastStatus(ws, connectionId, 'disconnected');
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId,
            direction: 'sys',
            message: `Disconnected from ${protocol.toUpperCase()}`,
            rawData: '',
            timestamp: Date.now(),
          },
        }));
      }
      break;
    }

    // ── 读取寄存器 ──
    case 'read': {
      const { connectionId, slaveId, functionCode, startAddress, quantity, tabId, mode } = payload as {
        connectionId: string;
        slaveId: number;
        functionCode: number;
        startAddress: number;
        quantity: number;
        tabId: string;
        mode: 'ascii' | 'rtu';
      };

      const conn = connectionConfigs.get(connectionId);
      if (!conn) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { connectionId, message: 'Connection not configured' },
        }));
        return;
      }

      const { config } = conn;
      const protocol = config.protocol;
      const fcName = `FC${String(functionCode).padStart(2, '0')}`;

      // 发送 TX 日志
      ws.send(JSON.stringify({
        type: 'log',
        payload: {
          connectionId,
          tabId,
          direction: 'tx',
          message: `${fcName} Read Addr:${startAddress} Qty:${quantity}`,
          rawData: '',
          timestamp: Date.now(),
        },
      }));

      let result;
      const actualMode = mode || config.mode || 'rtu';

      if (protocol === 'tcp') {
        result = await readTcpRegisters(connectionId, slaveId, functionCode, startAddress, quantity);
      } else if (protocol === 'udp') {
        const udp = config.udpConfig;
        result = await readUdpRegisters(connectionId, slaveId, functionCode, startAddress, quantity, udp?.host || '127.0.0.1', udp?.port || 502);
      } else if (protocol === 'serial') {
        result = await readSerialRegisters(connectionId, slaveId, functionCode, startAddress, quantity, actualMode.toUpperCase() as 'ASCII' | 'RTU');
      } else {
        result = { success: false, error: 'Unsupported protocol' };
      }

      if (result.success && result.data) {
        // 发送 RX 日志
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId,
            tabId,
            direction: 'rx',
            message: `${fcName} Response ${result.data.length} regs (${result.timing}ms)`,
            rawData: result.rawRx || '',
            timestamp: Date.now(),
          },
        }));

        // 发送数据
        ws.send(JSON.stringify({
          type: 'data',
          payload: {
            connectionId,
            tabId,
            registers: result.data,
            rawTx: result.rawTx,
            rawRx: result.rawRx,
            timing: result.timing,
          },
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { connectionId, tabId, message: result.error || 'Read failed' },
        }));
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId,
            tabId,
            direction: 'sys',
            message: `Read error: ${result.error}`,
            rawData: result.rawTx || '',
            timestamp: Date.now(),
          },
        }));
      }
      break;
    }

    // ── 写入操作 ──
    case 'write': {
      const { connectionId, slaveId, functionCode, address, values, tabId, mode } = payload as {
        connectionId: string;
        slaveId: number;
        functionCode: number;
        address: number;
        values: number[] | boolean[];
        tabId: string;
        mode: 'ascii' | 'rtu';
      };

      const conn = connectionConfigs.get(connectionId);
      if (!conn) {
        ws.send(JSON.stringify({ type: 'error', payload: { connectionId, message: 'Connection not configured' } }));
        return;
      }

      const { config } = conn;
      const protocol = config.protocol;
      const fcName = `FC${String(functionCode).padStart(2, '0')}`;
      const actualMode = mode || config.mode || 'rtu';

      // 发送 TX 日志
      ws.send(JSON.stringify({
        type: 'log',
        payload: {
          connectionId, tabId, direction: 'tx',
          message: `${fcName} Write Addr:${address}` + (Array.isArray(values) ? ` Qty:${values.length}` : ''),
          rawData: '', timestamp: Date.now(),
        },
      }));

      let result;
      try {
        if (functionCode === 5) {
          result = await writeSingleCoil(protocol, connectionId, slaveId, address, values[0] as boolean, actualMode.toUpperCase() as 'ASCII' | 'RTU', undefined, undefined, 2000);
        } else if (functionCode === 6) {
          result = await writeSingleRegister(protocol, connectionId, slaveId, address, values[0] as number, actualMode.toUpperCase() as 'ASCII' | 'RTU', undefined, undefined, 2000);
        } else if (functionCode === 15) {
          result = await writeMultipleCoils(protocol, connectionId, slaveId, address, values as boolean[], actualMode.toUpperCase() as 'ASCII' | 'RTU', undefined, undefined, 2000);
        } else if (functionCode === 16) {
          result = await writeMultipleRegisters(protocol, connectionId, slaveId, address, values as number[], actualMode.toUpperCase() as 'ASCII' | 'RTU', undefined, undefined, 2000);
        } else {
          result = { success: false, error: `Unsupported write function code: ${functionCode}` };
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result = { success: false, error: errMsg };
      }

      if (result.success) {
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId, tabId, direction: 'rx',
            message: `${fcName} Write success (${result.timing || '0'}ms)`,
            rawData: result.rawRx || '', timestamp: Date.now(),
          },
        }));
        ws.send(JSON.stringify({
          type: 'write_ack',
          payload: { connectionId, tabId, functionCode, address, rawTx: result.rawTx, rawRx: result.rawRx },
        }));
      } else {
        ws.send(JSON.stringify({ type: 'error', payload: { connectionId, tabId, message: result.error || 'Write failed' } }));
        ws.send(JSON.stringify({
          type: 'log',
          payload: {
            connectionId, tabId, direction: 'sys',
            message: `Write error: ${result.error}`, rawData: result.rawTx || '', timestamp: Date.now(),
          },
        }));
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