/**
 * ModBus 协议底层实现（TCP/UDP/Serial RTU/ASCII）
 * 用于后端服务进行真实 ModBus 设备通信
 */
import * as net from 'net';
import * as dgram from 'dgram';
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

// ── 响应类型 ──
export interface ModbusResponse {
  success: boolean;
  data?: number[];          // 寄存器值
  rawTx?: string;           // 发送的十六进制数据
  rawRx?: string;           // 接收的十六进制数据
  error?: string;
  timing?: number;          // 响应时间 ms
}

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

// ── 解析响应 ──

/** 解析 03 功能码的 RTU 响应 */
function parseRtuResponse(data: Buffer, expectedSlaveId: number, expectedFc: number): { registers: number[]; rawRx: string } {
  const rawRx = data.toString('hex').toUpperCase();
  if (data.length < 5) throw new Error('Response too short');
  if (data[0] !== expectedSlaveId) throw new Error(`Slave ID mismatch: expected ${expectedSlaveId}, got ${data[0]}`);
  if (data[1] === expectedFc + 0x80) throw new Error(`ModBus exception: ${data[2]}`);
  if (data[1] !== expectedFc) throw new Error(`Function code mismatch: expected ${expectedFc}, got ${data[1]}`);
  const byteCount = data[2];
  if (data.length < 3 + byteCount + 2) throw new Error('Response truncated');
  const registers: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    registers.push(data.readUInt16BE(3 + i));
  }
  return { registers, rawRx };
}

/** 解析 TCP 响应 */
function parseTcpResponse(data: Buffer, expectedFc: number): { registers: number[]; rawRx: string } {
  const rawRx = data.toString('hex').toUpperCase();
  if (data.length < 9) throw new Error('Response too short');
  const fc = data[7];
  if (fc === expectedFc + 0x80) throw new Error(`ModBus exception: ${data[8]}`);
  if (fc !== expectedFc) throw new Error(`Function code mismatch: expected ${expectedFc}, got ${fc}`);
  const byteCount = data[8];
  if (data.length < 9 + byteCount) throw new Error('Response truncated');
  const registers: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    registers.push(data.readUInt16BE(9 + i));
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
  if (!conn) return { success: false, error: 'Connection not found' };

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
        if (conn.buffer.length >= 9) {
          try {
            const { registers, rawRx } = parseTcpResponse(conn.buffer, functionCode);
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
            reject(e);
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
  if (!socket) return { success: false, error: 'UDP connection not found' };

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
          const { registers, rawRx } = parseTcpResponse(msg, functionCode);
          resolve({
            success: true,
            data: registers,
            rawTx,
            rawRx,
            timing: Date.now() - startTime,
          });
        } catch (e: unknown) {
          reject(e);
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
  if (!port || !port.isOpen) return { success: false, error: 'Serial port not open' };

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
              const { registers, rawRx: rxHex } = parseRtuResponse(rxBuffer, slaveId, functionCode);
              rawRx = rxHex;
              resolve({
                success: true,
                data: registers,
                rawTx,
                rawRx,
                timing: Date.now() - startTime,
              });
            } catch (e: unknown) {
              reject(e);
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
                reject(new Error(`Slave ID mismatch: expected ${slaveId}, got ${respData[0]}`));
                return;
              }
              if (respData[1] !== functionCode) {
                reject(new Error(`Function code mismatch: expected ${functionCode}, got ${respData[1]}`));
                return;
              }
              const byteCount = respData[2];
              const registers: number[] = [];
              for (let i = 0; i < byteCount; i += 2) {
                registers.push(respData.readUInt16BE(3 + i));
              }
              resolve({
                success: true,
                data: registers,
                rawTx,
                rawRx,
                timing: Date.now() - startTime,
              });
            } else {
              reject(new Error('Invalid ASCII response format'));
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
  pdu[1] = 0x05;
  pdu.writeUInt16BE(address, 2);
  pdu.writeUInt16BE(value ? 0xFF00 : 0x0000, 4);
  const crc = crc16(pdu);
  return Buffer.concat([pdu, crc]);
}

/** 构建写单个寄存器 (FC06) 的 RTU 帧 */
function buildWriteSingleRegisterRtu(slaveId: number, address: number, value: number): Buffer {
  const pdu = Buffer.alloc(6);
  pdu[0] = slaveId;
  pdu[1] = 0x06;
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
  pdu[1] = 0x0F;
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
  pdu[1] = 0x10;
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
    return writeSerial(connectionId, slaveId, buildWriteSingleCoilRtu(slaveId, address, value), mode, timeoutMs, 0x05);
  }
  const tid = globalTransactionId++;
  const pdu = Buffer.alloc(5);
  pdu[0] = 0x05;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value ? 0xFF00 : 0x0000, 3);
  const frame = buildTcpWriteFrame(slaveId, 0x05, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, host, port);
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
  if (protocol === 'serial') {
    return writeSerial(connectionId, slaveId, buildWriteSingleRegisterRtu(slaveId, address, value), mode, timeoutMs, 0x06);
  }
  const tid = globalTransactionId++;
  const pdu = Buffer.alloc(5);
  pdu[0] = 0x06;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value, 3);
  const frame = buildTcpWriteFrame(slaveId, 0x06, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, host, port);
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
    return writeSerial(connectionId, slaveId, buildWriteMultipleCoilsRtu(slaveId, startAddress, values), mode, timeoutMs, 0x0F);
  }
  const tid = globalTransactionId++;
  const quantity = values.length;
  const byteCount = Math.ceil(quantity / 8);
  const pdu = Buffer.alloc(6 + byteCount);
  pdu[0] = 0x0F;
  pdu.writeUInt16BE(startAddress, 1);
  pdu.writeUInt16BE(quantity, 3);
  pdu[5] = byteCount;
  for (let i = 0; i < quantity; i++) {
    if (values[i]) pdu[6 + Math.floor(i / 8)] |= (1 << (i % 8));
  }
  const frame = buildTcpWriteFrame(slaveId, 0x0F, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, host, port);
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
    return writeSerial(connectionId, slaveId, buildWriteMultipleRegistersRtu(slaveId, startAddress, values), mode, timeoutMs, 0x10);
  }
  const tid = globalTransactionId++;
  const quantity = values.length;
  const byteCount = quantity * 2;
  const pdu = Buffer.alloc(6 + byteCount);
  pdu[0] = 0x10;
  pdu.writeUInt16BE(startAddress, 1);
  pdu.writeUInt16BE(quantity, 3);
  pdu[5] = byteCount;
  for (let i = 0; i < quantity; i++) {
    pdu.writeUInt16BE(values[i], 6 + i * 2);
  }
  const frame = buildTcpWriteFrame(slaveId, 0x10, pdu, tid);
  const rawTx = frame.toString('hex').toUpperCase();
  return sendWriteFrame(protocol, connectionId, frame, tid, timeoutMs, rawTx, host, port);
}

/** 发送写帧并等待响应 */
async function sendWriteFrame(
  protocol: 'tcp' | 'udp',
  connectionId: string,
  frame: Buffer,
  transactionId: number,
  timeoutMs: number,
  rawTx: string,
  host?: string,
  port?: number,
): Promise<ModbusResponse> {
  if (protocol === 'tcp') {
    const conn = tcpConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found', rawTx };
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
            clearTimeout(timer);
            conn.buffer = Buffer.alloc(0);
            resolve({ success: true, rawTx, rawRx, timing: Date.now() - startTime });
          } catch (e) {
            clearTimeout(timer);
            reject(e);
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
    if (!socket) return { success: false, error: 'UDP connection not found', rawTx };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UDP write response timeout')), timeoutMs);
      const startTime = Date.now();
      socket.send(frame, port!, host!, (err) => {
        if (err) { clearTimeout(timer); reject(err); }
      });
      socket.once('message', (msg) => {
        clearTimeout(timer);
        const rawRx = msg.toString('hex').toUpperCase();
        resolve({ success: true, rawTx, rawRx, timing: Date.now() - startTime });
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
  if (!port || !port.isOpen) return { success: false, error: 'Serial port not open' };

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