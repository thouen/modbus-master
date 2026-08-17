/**
 * ModBus 协议底层实现（TCP/UDP/Serial RTU/ASCII）
 * 用于后端服务进行真实 ModBus 设备通信
 * Reference: libmodbus (https://github.com/stephane/libmodbus)
 *            Modicon Modbus Protocol Reference Guide (www.modbus.org)
 */
import * as net from 'net';
import * as dgram from 'dgram';
import { MODBUS_FC, MODBUS_MAX, getExceptionMessage } from './modbus-types';
import type { ModbusResponse } from './modbus-types';
// crc16 在本地实现（返回 Buffer），不使用 modbus-utils 中的版本
// 动态导入 serialport（仅在需要时加载）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SerialPort: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sp = require('serialport');
  SerialPort = sp.SerialPort;
} catch {
  // serialport 不可用，串口功能将报错
  SerialPort = null;
}
import type { ConnectionConfig, ModbusConnectionStatus } from './modbus-types';

// ── CRC16 (RTU) ──
const crc16Table = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (0xA001 ^ (crc >> 1)) : crc >> 1;
  }
  crc16Table[i] = crc;
}

function crc16(data: Buffer): Buffer {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >> 8) ^ crc16Table[(crc ^ data[i]) & 0xFF];
  }
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(crc, 0);
  return buf;
}

// ── LRC (ASCII) ──
function lrc(data: Buffer): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return ((~sum) + 1) & 0xFF;
}

// ── 构建 ModBus 帧 ──

/** 构建 RTU 请求帧 */
function buildRtuFrame(slaveId: number, functionCode: number, startAddress: number, quantity: number): Buffer {
  const pdu = Buffer.alloc(5);
  pdu[0] = slaveId;
  pdu[1] = functionCode;
  pdu.writeUInt16BE(startAddress, 2);
  pdu.writeUInt16BE(quantity, 4);
  const crc = crc16(pdu);
  return Buffer.concat([pdu, crc]);
}

/** 构建 ASCII 请求帧 */
function buildAsciiFrame(slaveId: number, functionCode: number, startAddress: number, quantity: number): string {
  const pdu = Buffer.alloc(5);
  pdu[0] = slaveId;
  pdu[1] = functionCode;
  pdu.writeUInt16BE(startAddress, 2);
  pdu.writeUInt16BE(quantity, 4);
  const lrcVal = lrc(pdu);
  const dataWithLrc = Buffer.concat([pdu, Buffer.from([lrcVal])]);
  const hex = dataWithLrc.toString('hex').toUpperCase();
  return `:${hex}\r\n`;
}

/** 构建 TCP MBAP 头 + 帧 */
function buildTcpFrame(slaveId: number, functionCode: number, startAddress: number, quantity: number, transactionId: number): Buffer {
  const pdu = Buffer.alloc(5);
  pdu[0] = functionCode;
  pdu.writeUInt16BE(startAddress, 1);
  pdu.writeUInt16BE(quantity, 3);
  const mbap = Buffer.alloc(7);
  mbap.writeUInt16BE(transactionId, 0);  // Transaction ID
  mbap.writeUInt16BE(0, 2);              // Protocol ID
  mbap.writeUInt16BE(pdu.length + 1, 4); // Length (PDU + Unit ID)
  mbap[6] = slaveId;                     // Unit ID
  return Buffer.concat([mbap, pdu]);
}

// ── 解析响应（参考 libmodbus check_confirmation） ──

/**
 * 解析 RTU 响应（通用，支持 FC01~FC06, FC15, FC16）
 * 参考 libmodbus: compute_response_length_from_request + check_confirmation
 */
function parseRtuResponse(
  data: Buffer,
  expectedSlaveId: number,
  expectedFc: number,
  quantity: number,
): { registers: number[]; rawRx: string } {
  const rawRx = data.toString('hex').toUpperCase();

  // 最小长度: slaveId(1) + fc(1) + data(1) + crc(2) = 5
  if (data.length < 5) {
    throw new Error(`Response too short (${data.length} bytes, minimum 5)`);
  }

  // 校验从站地址
  if (data[0] !== expectedSlaveId) {
    throw new Error(`Slave ID mismatch: expected ${expectedSlaveId}, got ${data[0]}`);
  }

  const fc = data[1];

  // 异常响应: FC >= 0x80
  if (fc >= 0x80) {
    const exCode = data[2];
    throw new Error(`ModBus exception: ${getExceptionMessage(exCode)}`);
  }

  // 校验功能码
  if (fc !== expectedFc) {
    throw new Error(`Function code mismatch: expected 0x${expectedFc.toString(16).toUpperCase().padStart(2, '0')}, got 0x${fc.toString(16).toUpperCase().padStart(2, '0')}`);
  }

  // 校验 CRC
  const receivedCrc = (data[data.length - 1] << 8) | data[data.length - 2];
  const crcBuf = crc16(data.subarray(0, data.length - 2));
  const calculatedCrc = (crcBuf[1] << 8) | crcBuf[0];
  if (receivedCrc !== calculatedCrc) {
    throw new Error(`CRC error: received 0x${receivedCrc.toString(16).toUpperCase().padStart(4, '0')}, calculated 0x${calculatedCrc.toString(16).toUpperCase().padStart(4, '0')}`);
  }

  // 根据功能码解析数据
  const registers: number[] = [];

  switch (fc) {
    case MODBUS_FC.READ_COILS:
    case MODBUS_FC.READ_DISCRETE_INPUTS: {
      // Response: slaveId(1) + fc(1) + byteCount(1) + data(N) + crc(2)
      const byteCount = data[2];
      if (data.length < 3 + byteCount + 2) {
        throw new Error('Response truncated (coil data)');
      }
      // 每个字节包含 8 个线圈位，低位在前
      for (let i = 0; i < byteCount; i++) {
        registers.push(data[3 + i]);
      }
      break;
    }

    case MODBUS_FC.READ_HOLDING_REGISTERS:
    case MODBUS_FC.READ_INPUT_REGISTERS: {
      // Response: slaveId(1) + fc(1) + byteCount(1) + data(N*2) + crc(2)
      const byteCount = data[2];
      if (data.length < 3 + byteCount + 2) {
        throw new Error('Response truncated (register data)');
      }
      if (byteCount !== quantity * 2) {
        throw new Error(`Byte count mismatch: expected ${quantity * 2}, got ${byteCount}`);
      }
      for (let i = 0; i < byteCount; i += 2) {
        registers.push(data.readUInt16BE(3 + i));
      }
      break;
    }

    case MODBUS_FC.WRITE_SINGLE_COIL:
    case MODBUS_FC.WRITE_SINGLE_REGISTER: {
      // Response echoes request: slaveId(1) + fc(1) + address(2) + value(2) + crc(2)
      if (data.length < 8) {
        throw new Error('Response truncated (write single)');
      }
      // 返回写入的值（单个寄存器）
      registers.push(data.readUInt16BE(4));
      break;
    }

    case MODBUS_FC.WRITE_MULTIPLE_COILS:
    case MODBUS_FC.WRITE_MULTIPLE_REGISTERS: {
      // Response: slaveId(1) + fc(1) + address(2) + quantity(2) + crc(2)
      if (data.length < 8) {
        throw new Error('Response truncated (write multiple)');
      }
      // 返回写入数量
      registers.push(data.readUInt16BE(4));
      break;
    }

    default:
      throw new Error(`Unsupported function code: 0x${fc.toString(16).toUpperCase().padStart(2, '0')}`);
  }

  return { registers, rawRx };
}

/**
 * 解析 TCP 响应（通用，支持 FC01~FC06, FC15, FC16）
 * 参考 libmodbus: _modbus_tcp_pre_check_confirmation + check_confirmation
 */
function parseTcpResponse(
  data: Buffer,
  expectedFc: number,
  expectedTid?: number,
  expectedSlaveId?: number,
  quantity?: number,
): { registers: number[]; rawRx: string } {
  const rawRx = data.toString('hex').toUpperCase();

  // MBAP 头最小长度: tid(2) + pid(2) + len(2) + uid(1) + fc(1) = 8
  if (data.length < 8) {
    throw new Error(`Response too short (${data.length} bytes, minimum 8 for MBAP header)`);
  }

  // 校验 Transaction ID
  const tid = data.readUInt16BE(0);
  if (expectedTid !== undefined && tid !== expectedTid) {
    throw new Error(`Transaction ID mismatch: expected 0x${expectedTid.toString(16).toUpperCase().padStart(4, '0')}, got 0x${tid.toString(16).toUpperCase().padStart(4, '0')}`);
  }

  // 校验 Protocol ID (必须为 0 = ModBus)
  const pid = data.readUInt16BE(2);
  if (pid !== 0) {
    throw new Error(`Invalid protocol ID: expected 0x0000, got 0x${pid.toString(16).toUpperCase().padStart(4, '0')}`);
  }

  // MBAP Length 字段
  const mbapLength = data.readUInt16BE(4);
  if (data.length < 6 + mbapLength) {
    throw new Error(`Response truncated: MBAP length=${mbapLength}, actual=${data.length - 6}`);
  }

  // Unit ID (slave)
  const unitId = data[6];
  if (expectedSlaveId !== undefined && unitId !== expectedSlaveId) {
    throw new Error(`Unit ID mismatch: expected ${expectedSlaveId}, got ${unitId}`);
  }

  const fc = data[7];

  // 异常响应: FC >= 0x80
  if (fc >= 0x80) {
    if (data.length < 9) {
      throw new Error('Exception response too short');
    }
    const exCode = data[8];
    throw new Error(`ModBus exception: ${getExceptionMessage(exCode)}`);
  }

  // 校验功能码
  if (fc !== expectedFc) {
    throw new Error(`Function code mismatch: expected 0x${expectedFc.toString(16).toUpperCase().padStart(2, '0')}, got 0x${fc.toString(16).toUpperCase().padStart(2, '0')}`);
  }

  // 根据功能码解析数据
  const registers: number[] = [];

  switch (fc) {
    case MODBUS_FC.READ_COILS:
    case MODBUS_FC.READ_DISCRETE_INPUTS: {
      // Response: MBAP(7) + fc(1) + byteCount(1) + data(N)
      if (data.length < 10) {
        throw new Error('Response truncated (coil header)');
      }
      const byteCount = data[8];
      if (data.length < 9 + byteCount) {
        throw new Error('Response truncated (coil data)');
      }
      for (let i = 0; i < byteCount; i++) {
        registers.push(data[9 + i]);
      }
      break;
    }

    case MODBUS_FC.READ_HOLDING_REGISTERS:
    case MODBUS_FC.READ_INPUT_REGISTERS: {
      // Response: MBAP(7) + fc(1) + byteCount(1) + data(N*2)
      if (data.length < 10) {
        throw new Error('Response truncated (register header)');
      }
      const byteCount = data[8];
      if (data.length < 9 + byteCount) {
        throw new Error('Response truncated (register data)');
      }
      if (quantity !== undefined && byteCount !== quantity * 2) {
        throw new Error(`Byte count mismatch: expected ${quantity * 2}, got ${byteCount}`);
      }
      for (let i = 0; i < byteCount; i += 2) {
        registers.push(data.readUInt16BE(9 + i));
      }
      break;
    }

    case MODBUS_FC.WRITE_SINGLE_COIL:
    case MODBUS_FC.WRITE_SINGLE_REGISTER: {
      // Response echoes: MBAP(7) + fc(1) + address(2) + value(2)
      if (data.length < 12) {
        throw new Error('Response truncated (write single)');
      }
      registers.push(data.readUInt16BE(10));
      break;
    }

    case MODBUS_FC.WRITE_MULTIPLE_COILS:
    case MODBUS_FC.WRITE_MULTIPLE_REGISTERS: {
      // Response: MBAP(7) + fc(1) + address(2) + quantity(2)
      if (data.length < 12) {
        throw new Error('Response truncated (write multiple)');
      }
      registers.push(data.readUInt16BE(10));
      break;
    }

    default:
      throw new Error(`Unsupported function code: 0x${fc.toString(16).toUpperCase().padStart(2, '0')}`);
  }

  return { registers, rawRx };
}

// ── 连接管理 ──

interface TcpConnection {
  socket: net.Socket;
  transactionId: number;
  buffer: Buffer;
}

const tcpConnections = new Map<string, TcpConnection>();
const udpConnections = new Map<string, dgram.Socket>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serialConnections = new Map<string, any>();

let globalTransactionId = 1;

// ── TCP 连接 ──

export async function connectTcp(
  connectionId: string,
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connection timeout to ${host}:${port}`));
    }, timeoutMs);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      const existing = tcpConnections.get(connectionId);
      if (existing) existing.socket.destroy();
      tcpConnections.set(connectionId, { socket, transactionId: 0, buffer: Buffer.alloc(0) });
      resolve();
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('data', (chunk) => {
      const conn = tcpConnections.get(connectionId);
      if (conn) conn.buffer = Buffer.concat([conn.buffer, chunk]);
    });
  });
}

export async function disconnectTcp(connectionId: string): Promise<void> {
  const conn = tcpConnections.get(connectionId);
  if (conn) {
    conn.socket.destroy();
    tcpConnections.delete(connectionId);
  }
}

export async function readTcpRegisters(
  connectionId: string,
  slaveId: number,
  functionCode: number,
  startAddress: number,
  quantity: number,
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  const conn = tcpConnections.get(connectionId);
  if (!conn) return { success: false, error: 'Connection not found', rawTx: '', rawRx: '' };

  const tid = globalTransactionId++;
  const frame = buildTcpFrame(slaveId, functionCode, startAddress, quantity, tid);
  const rawTx = frame.toString('hex').toUpperCase();

  try {
    return await new Promise((resolve, reject) => {
      conn.buffer = Buffer.alloc(0);
      conn.transactionId = tid;
      const timer = setTimeout(() => reject(new Error('Response timeout')), timeoutMs);

      conn.socket.write(frame, (err) => {
        if (err) { clearTimeout(timer); reject(err); }
      });

      const startTime = Date.now();
      const checkResponse = () => {
        // MBAP header minimum: tid(2) + pid(2) + len(2) + uid(1) = 7 bytes
        if (conn.buffer.length >= 7) {
          // MBAP Length field = PDU + Unit ID length
          const mbapLength = conn.buffer.readUInt16BE(4);
          const expectedTotal = 6 + mbapLength; // 6 bytes header before length field + mbapLength
          if (conn.buffer.length >= expectedTotal) {
            try {
              const { registers, rawRx } = parseTcpResponse(conn.buffer, functionCode, tid, slaveId, quantity);
              clearTimeout(timer);
              conn.buffer = Buffer.alloc(0);
              resolve({
                success: true,
                data: registers,
                rawTx,
                rawRx,
                timing: Date.now() - startTime,
              });
            } catch (e) {
              clearTimeout(timer);
              // Extract exception code if available
              const errorMsg = e instanceof Error ? e.message : String(e);
              const exMatch = errorMsg.match(/ModBus exception: (\d+)/);
              const exceptionCode = exMatch ? parseInt(exMatch[1]) : undefined;
              resolve({
                success: false,
                error: errorMsg,
                rawTx,
                rawRx: conn.buffer.toString('hex').toUpperCase(),
                timing: Date.now() - startTime,
                exceptionCode,
              });
              conn.buffer = Buffer.alloc(0);
            }
          } else {
            setTimeout(checkResponse, 50);
          }
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg, rawTx, rawRx: '' };
  }
}

// ── UDP 连接 ──

export async function connectUdp(connectionId: string, host: string, port: number): Promise<void> {
  const existing = udpConnections.get(connectionId);
  if (existing) existing.close();

  const socket = dgram.createSocket('udp4');
  socket.bind();
  udpConnections.set(connectionId, socket);
}

export async function disconnectUdp(connectionId: string): Promise<void> {
  const socket = udpConnections.get(connectionId);
  if (socket) {
    socket.close();
    udpConnections.delete(connectionId);
  }
}

export async function readUdpRegisters(
  connectionId: string,
  slaveId: number,
  functionCode: number,
  startAddress: number,
  quantity: number,
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  const socket = udpConnections.get(connectionId);
  if (!socket) return { success: false, error: 'UDP connection not found', rawTx: '', rawRx: '' };

  const tid = globalTransactionId++;
  const frame = buildTcpFrame(slaveId, functionCode, startAddress, quantity, tid);
  const rawTx = frame.toString('hex').toUpperCase();

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UDP response timeout')), timeoutMs);
      const startTime = Date.now();

      socket.send(frame, port, host, (err) => {
        if (err) { clearTimeout(timer); reject(err); }
      });

      socket.once('message', (msg) => {
        clearTimeout(timer);
        try {
          const { registers, rawRx } = parseTcpResponse(msg, functionCode, tid, slaveId, quantity);
          resolve({
            success: true,
            data: registers,
            rawTx,
            rawRx,
            timing: Date.now() - startTime,
          });
        } catch (e: unknown) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          const exMatch = errorMsg.match(/ModBus exception: (\d+)/);
          const exceptionCode = exMatch ? parseInt(exMatch[1]) : undefined;
          resolve({
            success: false,
            error: errorMsg,
            rawTx,
            rawRx: msg.toString('hex').toUpperCase(),
            timing: Date.now() - startTime,
            exceptionCode,
          });
        }
      });
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg, rawTx, rawRx: '' };
  }
}

// ── Serial 连接 ──

export async function connectSerial(
  connectionId: string,
  path: string,
  baudRate: number,
  dataBits: 5 | 6 | 7 | 8 = 8,
  stopBits: 1 | 2 = 1,
  parity: 'none' | 'even' | 'odd' = 'none',
): Promise<void> {
  const existing = serialConnections.get(connectionId);
  if (existing) {
    existing.close();
    serialConnections.delete(connectionId);
  }

  const port = new SerialPort({
    path,
    baudRate,
    dataBits,
    stopBits,
    parity,
    autoOpen: false,
  });

  return new Promise((resolve, reject) => {
    port.open((err: Error | null) => {
      if (err) reject(err);
      else {
        serialConnections.set(connectionId, port);
        resolve();
      }
    });
  });
}

export async function disconnectSerial(connectionId: string): Promise<void> {
  const port = serialConnections.get(connectionId);
  if (port) {
    port.close();
    serialConnections.delete(connectionId);
  }
}

export async function readSerialRegisters(
  connectionId: string,
  slaveId: number,
  functionCode: number,
  startAddress: number,
  quantity: number,
  mode: 'ASCII' | 'RTU',
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  const port = serialConnections.get(connectionId);
  if (!port || !port.isOpen) return { success: false, error: 'Serial port not open', rawTx: '', rawRx: '' };

  let rawTx = '';
  let rawRx = '';

  try {
    if (mode === 'RTU') {
      const frame = buildRtuFrame(slaveId, functionCode, startAddress, quantity);
      rawTx = frame.toString('hex').toUpperCase();

      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Serial response timeout')), timeoutMs);
        const startTime = Date.now();
        let rxBuffer = Buffer.alloc(0);

        port.on('data', (data: Buffer) => {
          rxBuffer = Buffer.concat([rxBuffer, data]);
          // RTU: 最小 5 字节 (slaveId + fc + byteCount + data + crc)
          const minLen = 3 + 2 + 2; // slaveId(1) + fc(1) + byteCount(1) + data(min 2) + crc(2)
          if (rxBuffer.length >= minLen) {
            clearTimeout(timer);
            try {
              const { registers, rawRx: rxHex } = parseRtuResponse(rxBuffer, slaveId, functionCode, quantity);
              rawRx = rxHex;
              resolve({
                success: true,
                data: registers,
                rawTx,
                rawRx,
                timing: Date.now() - startTime,
              });
            } catch (e: unknown) {
              const errorMsg = e instanceof Error ? e.message : String(e);
              const exMatch = errorMsg.match(/ModBus exception: (\d+)/);
              const exceptionCode = exMatch ? parseInt(exMatch[1]) : undefined;
              resolve({
                success: false,
                error: errorMsg,
                rawTx,
                rawRx: rxBuffer.toString('hex').toUpperCase(),
                timing: Date.now() - startTime,
                exceptionCode,
              });
            }
          }
        });

        port.write(frame, (err: Error | null) => {
          if (err) { clearTimeout(timer); reject(err); }
        });
      });
    } else {
      // ASCII mode
      const asciiFrame = buildAsciiFrame(slaveId, functionCode, startAddress, quantity);
      rawTx = asciiFrame.trim();

      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Serial response timeout')), timeoutMs);
        const startTime = Date.now();
        let rxStr = '';

        port.on('data', (data: Buffer) => {
          rxStr += data.toString('ascii');
          if (rxStr.includes('\r\n')) {
            clearTimeout(timer);
            // Parse ASCII response
            const match = rxStr.match(/^:([A-F0-9]+)\r\n$/);
            if (match) {
              rawRx = match[1];
              const respData = Buffer.from(match[1], 'hex');
              if (respData[0] !== slaveId) {
                resolve({
                  success: false,
                  error: `Slave ID mismatch: expected ${slaveId}, got ${respData[0]}`,
                  rawTx,
                  rawRx,
                  timing: Date.now() - startTime,
                });
                return;
              }
              // Check for exception response (function code + 0x80)
              if (respData[1] === functionCode + 0x80) {
                const exCode = respData[2];
                resolve({
                  success: false,
                  error: `ModBus exception: ${exCode} - ${getExceptionMessage(exCode)}`,
                  rawTx,
                  rawRx,
                  timing: Date.now() - startTime,
                  exceptionCode: exCode,
                });
                return;
              }
              if (respData[1] !== functionCode) {
                resolve({
                  success: false,
                  error: `Function code mismatch: expected ${functionCode}, got ${respData[1]}`,
                  rawTx,
                  rawRx,
                  timing: Date.now() - startTime,
                });
                return;
              }
              const byteCount = respData[2];
              const registers: number[] = [];
              // Coil/discrete input response: byteCount bytes, each bit = 1 value
              if (functionCode === MODBUS_FC.READ_COILS || functionCode === MODBUS_FC.READ_DISCRETE_INPUTS) {
                for (let i = 0; i < byteCount; i++) {
                  for (let bit = 0; bit < 8; bit++) {
                    registers.push((respData[3 + i] >> bit) & 1);
                  }
                }
              } else {
                // Register response: 2 bytes per register
                for (let i = 0; i < byteCount; i += 2) {
                  registers.push(respData.readUInt16BE(3 + i));
                }
              }
              resolve({
                success: true,
                data: registers,
                rawTx,
                rawRx,
                timing: Date.now() - startTime,
              });
            } else {
              resolve({
                success: false,
                error: 'Invalid ASCII response format',
                rawTx,
                rawRx: rxStr.trim(),
                timing: Date.now() - startTime,
              });
            }
          }
        });

        port.write(asciiFrame, (err: Error | null) => {
          if (err) { clearTimeout(timer); reject(err); }
        });
      });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg, rawTx, rawRx: '' };
  }
}

// ── 写入操作 ──

/** 构建写单个线圈 (FC05) 的 RTU 帧 */
function buildWriteSingleCoilRtu(slaveId: number, address: number, value: boolean): Buffer {
  const pdu = Buffer.alloc(6);
  pdu[0] = slaveId;
  pdu[1] = MODBUS_FC.WRITE_SINGLE_COIL;
  pdu.writeUInt16BE(address, 2);
  pdu.writeUInt16BE(value ? 0xFF00 : 0x0000, 4);
  const crc = crc16(pdu);
  return Buffer.concat([pdu, crc]);
}

/** 构建写单个寄存器 (FC06) 的 RTU 帧 */
function buildWriteSingleRegisterRtu(slaveId: number, address: number, value: number): Buffer {
  const pdu = Buffer.alloc(6);
  pdu[0] = slaveId;
  pdu[1] = MODBUS_FC.WRITE_SINGLE_REGISTER;
  pdu.writeUInt16BE(address, 2);
  pdu.writeUInt16BE(value, 4);
  const crc = crc16(pdu);
  return Buffer.concat([pdu, crc]);
}

/** 构建写多个线圈 (FC15) 的 RTU 帧 */
function buildWriteMultipleCoilsRtu(slaveId: number, startAddress: number, values: boolean[]): Buffer {
  const quantity = values.length;
  const byteCount = Math.ceil(quantity / 8);
  const pdu = Buffer.alloc(7 + byteCount);
  pdu[0] = slaveId;
  pdu[1] = MODBUS_FC.WRITE_MULTIPLE_COILS;
  pdu.writeUInt16BE(startAddress, 2);
  pdu.writeUInt16BE(quantity, 4);
  pdu[6] = byteCount;
  for (let i = 0; i < quantity; i++) {
    if (values[i]) pdu[7 + Math.floor(i / 8)] |= (1 << (i % 8));
  }
  const crc = crc16(pdu);
  return Buffer.concat([pdu, crc]);
}

/** 构建写多个寄存器 (FC16) 的 RTU 帧 */
function buildWriteMultipleRegistersRtu(slaveId: number, startAddress: number, values: number[]): Buffer {
  const quantity = values.length;
  const byteCount = quantity * 2;
  const pdu = Buffer.alloc(7 + byteCount);
  pdu[0] = slaveId;
  pdu[1] = MODBUS_FC.WRITE_MULTIPLE_REGISTERS;
  pdu.writeUInt16BE(startAddress, 2);
  pdu.writeUInt16BE(quantity, 4);
  pdu[6] = byteCount;
  for (let i = 0; i < quantity; i++) {
    pdu.writeUInt16BE(values[i], 7 + i * 2);
  }
  const crc = crc16(pdu);
  return Buffer.concat([pdu, crc]);
}

/** 构建 TCP 写帧 */
function buildTcpWriteFrame(slaveId: number, functionCode: number, data: Buffer, transactionId: number): Buffer {
  const mbap = Buffer.alloc(7);
  mbap.writeUInt16BE(transactionId, 0);
  mbap.writeUInt16BE(0, 2);
  mbap.writeUInt16BE(data.length + 1, 4);
  mbap[6] = slaveId;
  return Buffer.concat([mbap, data]);
}

/** 写单个线圈 (FC05) */
export async function writeSingleCoil(
  protocol: 'tcp' | 'udp' | 'serial',
  connectionId: string,
  slaveId: number,
  address: number,
  value: boolean,
  mode: 'ASCII' | 'RTU' = 'RTU',
  host?: string,
  port?: number,
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  if (protocol === 'serial') {
    return writeSerial(connectionId, slaveId, buildWriteSingleCoilRtu(slaveId, address, value), mode, timeoutMs, MODBUS_FC.WRITE_SINGLE_COIL);
  }
  const tid = globalTransactionId++;
  const pdu = Buffer.alloc(5);
  pdu[0] = MODBUS_FC.WRITE_SINGLE_COIL;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value ? 0xFF00 : 0x0000, 3);
  const frame = buildTcpWriteFrame(slaveId, MODBUS_FC.WRITE_SINGLE_COIL, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, MODBUS_FC.WRITE_SINGLE_COIL, slaveId, host, port);
}

/** 写单个寄存器 (FC06) */
export async function writeSingleRegister(
  protocol: 'tcp' | 'udp' | 'serial',
  connectionId: string,
  slaveId: number,
  address: number,
  value: number,
  mode: 'ASCII' | 'RTU' = 'RTU',
  host?: string,
  port?: number,
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  // 值范围校验：16 位无符号整数 0~65535
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    return { success: false, error: `FC06 value out of range: ${value} (must be 0~65535)`, rawTx: '', rawRx: '', timing: 0 };
  }
  if (protocol === 'serial') {
    return writeSerial(connectionId, slaveId, buildWriteSingleRegisterRtu(slaveId, address, value), mode, timeoutMs, MODBUS_FC.WRITE_SINGLE_REGISTER);
  }
  const tid = globalTransactionId++;
  const pdu = Buffer.alloc(5);
  pdu[0] = MODBUS_FC.WRITE_SINGLE_REGISTER;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value, 3);
  const frame = buildTcpWriteFrame(slaveId, MODBUS_FC.WRITE_SINGLE_REGISTER, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, MODBUS_FC.WRITE_SINGLE_REGISTER, slaveId, host, port);
}

/** 写多个线圈 (FC15) */
export async function writeMultipleCoils(
  protocol: 'tcp' | 'udp' | 'serial',
  connectionId: string,
  slaveId: number,
  startAddress: number,
  values: boolean[],
  mode: 'ASCII' | 'RTU' = 'RTU',
  host?: string,
  port?: number,
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  if (protocol === 'serial') {
    return writeSerial(connectionId, slaveId, buildWriteMultipleCoilsRtu(slaveId, startAddress, values), mode, timeoutMs, MODBUS_FC.WRITE_MULTIPLE_COILS);
  }
  const tid = globalTransactionId++;
  const quantity = values.length;
  const byteCount = Math.ceil(quantity / 8);
  const pdu = Buffer.alloc(6 + byteCount);
  pdu[0] = MODBUS_FC.WRITE_MULTIPLE_COILS;
  pdu.writeUInt16BE(startAddress, 1);
  pdu.writeUInt16BE(quantity, 3);
  pdu[5] = byteCount;
  for (let i = 0; i < quantity; i++) {
    if (values[i]) pdu[6 + Math.floor(i / 8)] |= (1 << (i % 8));
  }
  const frame = buildTcpWriteFrame(slaveId, MODBUS_FC.WRITE_MULTIPLE_COILS, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, MODBUS_FC.WRITE_MULTIPLE_COILS, slaveId, host, port);
}

/** 写多个寄存器 (FC16) */
export async function writeMultipleRegisters(
  protocol: 'tcp' | 'udp' | 'serial',
  connectionId: string,
  slaveId: number,
  startAddress: number,
  values: number[],
  mode: 'ASCII' | 'RTU' = 'RTU',
  host?: string,
  port?: number,
  timeoutMs = 2000,
): Promise<ModbusResponse> {
  if (protocol === 'serial') {
    return writeSerial(connectionId, slaveId, buildWriteMultipleRegistersRtu(slaveId, startAddress, values), mode, timeoutMs, MODBUS_FC.WRITE_MULTIPLE_REGISTERS);
  }
  const tid = globalTransactionId++;
  const quantity = values.length;
  const byteCount = quantity * 2;
  const pdu = Buffer.alloc(6 + byteCount);
  pdu[0] = MODBUS_FC.WRITE_MULTIPLE_REGISTERS;
  pdu.writeUInt16BE(startAddress, 1);
  pdu.writeUInt16BE(quantity, 3);
  pdu[5] = byteCount;
  for (let i = 0; i < quantity; i++) {
    pdu.writeUInt16BE(values[i], 6 + i * 2);
  }
  const frame = buildTcpWriteFrame(slaveId, MODBUS_FC.WRITE_MULTIPLE_REGISTERS, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, MODBUS_FC.WRITE_MULTIPLE_REGISTERS, slaveId, host, port);
}

/** 发送写帧并等待响应 */
async function sendWriteFrame(
  protocol: 'tcp' | 'udp',
  connectionId: string,
  frame: Buffer,
  transactionId: number,
  timeoutMs: number,
  rawTx: string,
  expectedFc: number,
  expectedSlaveId: number,
  host?: string,
  port?: number,
): Promise<ModbusResponse> {
  if (protocol === 'tcp') {
    const conn = tcpConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found', rawTx, rawRx: '' };
    return new Promise((resolve, reject) => {
      conn.buffer = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error('Write response timeout')), timeoutMs);
      const startTime = Date.now();
      conn.socket.write(frame, (err) => {
        if (err) { clearTimeout(timer); reject(err); }
      });
      const checkResponse = () => {
        if (conn.buffer.length >= 9) {
          try {
            const rawRx = conn.buffer.toString('hex').toUpperCase();
            // 校验响应：异常码、FC 回显、地址/值验证
            parseTcpResponse(conn.buffer, expectedFc, transactionId, expectedSlaveId);
            clearTimeout(timer);
            conn.buffer = Buffer.alloc(0);
            resolve({ success: true, rawTx, rawRx, timing: Date.now() - startTime });
          } catch (e) {
            const errRawRx = conn.buffer.toString('hex').toUpperCase();
            clearTimeout(timer);
            conn.buffer = Buffer.alloc(0);
            resolve({ success: false, error: e instanceof Error ? e.message : String(e), rawTx, rawRx: errRawRx, timing: Date.now() - startTime });
          }
        } else {
          setTimeout(checkResponse, 50);
        }
      };
      checkResponse();
    });
  } else {
    // UDP
    const socket = udpConnections.get(connectionId);
    if (!socket) return { success: false, error: 'UDP connection not found', rawTx, rawRx: '' };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UDP write response timeout')), timeoutMs);
      const startTime = Date.now();
      socket.send(frame, port!, host!, (err) => {
        if (err) { clearTimeout(timer); reject(err); }
      });
      socket.once('message', (msg) => {
        clearTimeout(timer);
        const rawRx = msg.toString('hex').toUpperCase();
        try {
          // UDP 响应也需要校验（MBAP 头格式与 TCP 相同）
          parseTcpResponse(msg, expectedFc, transactionId, expectedSlaveId);
          resolve({ success: true, rawTx, rawRx, timing: Date.now() - startTime });
        } catch (e) {
          resolve({ success: false, error: e instanceof Error ? e.message : String(e), rawTx, rawRx, timing: Date.now() - startTime });
        }
      });
    });
  }
}

/** 串口写操作（通用） */
async function writeSerial(
  connectionId: string,
  slaveId: number,
  frame: Buffer,
  mode: 'ASCII' | 'RTU',
  timeoutMs: number,
  expectedFc: number,
): Promise<ModbusResponse> {
  const port = serialConnections.get(connectionId);
  if (!port || !port.isOpen) return { success: false, error: 'Serial port not open', rawTx: '', rawRx: '' };

  const rawTx = frame.toString('hex').toUpperCase();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'Serial write response timeout', rawTx, rawRx: '' });
    }, timeoutMs);
    const startTime = Date.now();
    let rxBuffer = Buffer.alloc(0);

    port.on('data', (data: Buffer) => {
      rxBuffer = Buffer.concat([rxBuffer, data]);
      if (rxBuffer.length >= 4) {
        clearTimeout(timer);
        const rawRx = rxBuffer.toString('hex').toUpperCase();

        // Check for exception response
        if (rxBuffer[1] === (expectedFc | 0x80)) {
          const excCode = rxBuffer[2];
          resolve({ success: false, error: `Exception ${excCode}: ${getExceptionMessage(excCode)}`, rawTx, rawRx, timing: Date.now() - startTime });
          return;
        }

        resolve({ success: true, rawTx, rawRx, timing: Date.now() - startTime });
      }
    });

    port.write(frame, (err: Error | null) => {
      if (err) { clearTimeout(timer); resolve({ success: false, error: err.message, rawTx, rawRx: '' }); }
    });
  });
}

// ── 断开所有连接 ──

export function disconnectAll() {
  for (const [id, conn] of tcpConnections) {
    conn.socket.destroy();
    tcpConnections.delete(id);
  }
  for (const [id, socket] of udpConnections) {
    socket.close();
    udpConnections.delete(id);
  }
  for (const [id, port] of serialConnections) {
    port.close();
    serialConnections.delete(id);
  }
}