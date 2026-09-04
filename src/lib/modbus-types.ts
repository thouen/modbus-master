// ModBus Protocol Types
// Reference: libmodbus (https://github.com/stephane/libmodbus)
//            Modicon Modbus Protocol Reference Guide (www.modbus.org)

export type Protocol = 'serial' | 'tcp';
export type Mode = 'ascii' | 'rtu';
export type FunctionCode = '01' | '02' | '03' | '04' | '05' | '06' | '15' | '16';

/** ModBus 广播从站地址：0（仅写操作有效，无响应） */
export const MODBUS_BROADCAST_SLAVE_ID = 0;

/** 判断是否为广播从站地址 */
export function isBroadcastSlave(slaveId: number): boolean {
  return slaveId === MODBUS_BROADCAST_SLAVE_ID;
}

export type ModbusConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export type ByteOrder32 = 'ABCD' | 'DCBA' | 'BADC' | 'CDAB';
export type ByteOrder64 = 'ABCDEFGH' | 'HGFEDCBA' | 'BADCFEHG' | 'GHEFCDAB';

export type DataDisplayFormat =
  | 'led'        // 1-bit LED
  | 'short'      // 16-bit signed
  | 'ushort'     // 16-bit unsigned
  | 'hex'        // 16-bit hexadecimal
  | 'binary'     // 16-bit binary
  | 'long'       // 32-bit signed integer
  | 'ulong'      // 32-bit unsigned integer
  | 'float'      // 32-bit float
  | 'double';    // 64-bit double

// ── ModBus Function Codes (from libmodbus modbus.h) ──

export const MODBUS_FC = {
  READ_COILS:                0x01,
  READ_DISCRETE_INPUTS:      0x02,
  READ_HOLDING_REGISTERS:    0x03,
  READ_INPUT_REGISTERS:      0x04,
  WRITE_SINGLE_COIL:         0x05,
  WRITE_SINGLE_REGISTER:     0x06,
  READ_EXCEPTION_STATUS:     0x07,
  WRITE_MULTIPLE_COILS:      0x0F,
  WRITE_MULTIPLE_REGISTERS:  0x10,
  REPORT_SLAVE_ID:           0x11,
  MASK_WRITE_REGISTER:       0x16,
  WRITE_AND_READ_REGISTERS:  0x17,
} as const;

// ── ModBus Protocol Limits (from Modicon Modbus Protocol Reference Guide) ──

export const MODBUS_MAX = {
  /** Max coils to read: 2000 (0x7D0) */
  READ_BITS: 2000,
  /** Max coils to write: 1968 (0x7B0) */
  WRITE_BITS: 1968,
  /** Max registers to read: 125 (0x7D) */
  READ_REGISTERS: 125,
  /** Max registers to write: 123 (0x7B) */
  WRITE_REGISTERS: 123,
  /** Max PDU length: 253 bytes (256 - slave(1) - CRC(2)) */
  PDU_LENGTH: 253,
  /** Max ADU length: 260 bytes (253 + MBAP(7)) */
  ADU_LENGTH: 260,
} as const;

// ── ModBus Exception Codes (from libmodbus modbus.h) ──

export const MODBUS_EXCEPTION = {
  ILLEGAL_FUNCTION:        0x01,
  ILLEGAL_DATA_ADDRESS:    0x02,
  ILLEGAL_DATA_VALUE:      0x03,
  SLAVE_OR_SERVER_FAILURE: 0x04,
  ACKNOWLEDGE:             0x05,
  SLAVE_OR_SERVER_BUSY:    0x06,
  NEGATIVE_ACKNOWLEDGE:    0x07,
  MEMORY_PARITY:           0x08,
  GATEWAY_PATH:            0x0A,
  GATEWAY_TARGET:          0x0B,
} as const;

/** Human-readable exception code descriptions */
export const MODBUS_EXCEPTION_MESSAGES: Record<number, string> = {
  [MODBUS_EXCEPTION.ILLEGAL_FUNCTION]:        'Illegal function (0x01)',
  [MODBUS_EXCEPTION.ILLEGAL_DATA_ADDRESS]:    'Illegal data address (0x02)',
  [MODBUS_EXCEPTION.ILLEGAL_DATA_VALUE]:      'Illegal data value (0x03)',
  [MODBUS_EXCEPTION.SLAVE_OR_SERVER_FAILURE]: 'Slave device failure (0x04)',
  [MODBUS_EXCEPTION.ACKNOWLEDGE]:             'Acknowledge (0x05)',
  [MODBUS_EXCEPTION.SLAVE_OR_SERVER_BUSY]:    'Slave device busy (0x06)',
  [MODBUS_EXCEPTION.NEGATIVE_ACKNOWLEDGE]:    'Negative acknowledge (0x07)',
  [MODBUS_EXCEPTION.MEMORY_PARITY]:           'Memory parity error (0x08)',
  [MODBUS_EXCEPTION.GATEWAY_PATH]:            'Gateway path unavailable (0x0A)',
  [MODBUS_EXCEPTION.GATEWAY_TARGET]:          'Gateway target failed to respond (0x0B)',
};

/** Get exception message from exception code */
export function getExceptionMessage(code: number): string {
  return MODBUS_EXCEPTION_MESSAGES[code] ?? `Unknown exception (0x${code.toString(16).toUpperCase().padStart(2, '0')})`;
}

/** Check if a function code is a bit/coil type */
export function isBitFC(fc: number | string): boolean {
  const code = typeof fc === 'string' ? parseInt(fc, 16) : fc;
  return code === MODBUS_FC.READ_COILS ||
         code === MODBUS_FC.READ_DISCRETE_INPUTS ||
         code === MODBUS_FC.WRITE_SINGLE_COIL ||
         code === MODBUS_FC.WRITE_MULTIPLE_COILS;
}

/** Check if a function code is a write type */
export function isWriteFC(fc: number | string): boolean {
  const code = typeof fc === 'string' ? parseInt(fc, 16) : fc;
  return code === MODBUS_FC.WRITE_SINGLE_COIL ||
         code === MODBUS_FC.WRITE_SINGLE_REGISTER ||
         code === MODBUS_FC.WRITE_MULTIPLE_COILS ||
         code === MODBUS_FC.WRITE_MULTIPLE_REGISTERS;
}

/** Check if a function code is a read type */
export function isReadFC(fc: number | string): boolean {
  return !isWriteFC(fc);
}

/** Get the expected response byte count for a read request */
export function getExpectedResponseLength(
  fc: number,
  quantity: number,
  isTcp: boolean,
): number {
  const headerLen = isTcp ? 9 : 0; // TCP MBAP(7) + slaveId(1) + fc(1) = 9; RTU header = 0 (slaveId+fc already in PDU)
  const checksumLen = isTcp ? 0 : 2; // RTU CRC = 2 bytes; TCP has no checksum

  switch (fc) {
    case MODBUS_FC.READ_COILS:
    case MODBUS_FC.READ_DISCRETE_INPUTS:
      // Response: header + byteCount(1) + data(ceil(quantity/8)) + checksum
      return headerLen + 1 + Math.ceil(quantity / 8) + checksumLen;
    case MODBUS_FC.READ_HOLDING_REGISTERS:
    case MODBUS_FC.READ_INPUT_REGISTERS:
      // Response: header + byteCount(1) + data(quantity*2) + checksum
      return headerLen + 1 + quantity * 2 + checksumLen;
    case MODBUS_FC.WRITE_SINGLE_COIL:
    case MODBUS_FC.WRITE_SINGLE_REGISTER:
      // Response echoes the request: header + address(2) + value(2) + checksum
      return headerLen + 5 + checksumLen;
    case MODBUS_FC.WRITE_MULTIPLE_COILS:
    case MODBUS_FC.WRITE_MULTIPLE_REGISTERS:
      // Response: header + address(2) + quantity(2) + checksum
      return headerLen + 5 + checksumLen;
    default:
      return -1; // Unknown
  }
}

/** ModBus 通信响应 */
export interface ModbusResponse {
  success: boolean;
  data?: number[];          // 寄存器值（读操作）或写入确认值
  rawTx: string;            // 发送的十六进制数据（modbus-serial 不暴露原始帧，留空）
  rawRx: string;            // 接收的十六进制数据（modbus-serial 不暴露原始帧，留空）
  error?: string;
  timing?: number;          // 响应时间 ms
  exceptionCode?: number;   // ModBus 异常码 (0x01~0x0B)
  broadcast?: boolean;      // 是否为广播写入（无响应，超时视为成功）
}

export interface SerialConfig {
  port: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

export interface TcpConfig {
  host: string;
  port: number;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  protocol: Protocol;
  mode: Mode;
  serialConfig?: SerialConfig;
  tcpConfig?: TcpConfig;
  slaveId: number;
  /** Per-connection default byte order for 32-bit values */
  byteOrder32: ByteOrder32;
  /** Per-connection default byte order for 64-bit values */
  byteOrder64: ByteOrder64;
}

export interface RegisterTab {
  id: string;
  name: string;
  connectionId: string;
  startAddress: number;
  quantity: number;
  functionCode: FunctionCode;
  pollInterval: number; // ms
  displayFormat: DataDisplayFormat;
  byteOrder32: ByteOrder32;
  byteOrder64: ByteOrder64;
  isPolling: boolean;
}

export interface RegisterData {
  address: number;
  rawValue: number; // 16-bit unsigned
}

export interface LogEntry {
  id: string;
  timestamp: number;
  connectionId: string;
  tabId?: string; // optional: which tab triggered this log
  direction: 'tx' | 'rx' | 'sys';
  type: 'info' | 'data' | 'error';
  message: string;
  rawData?: string;
}

export interface SavedProfile {
  id: string;
  name: string;
  connections: ConnectionConfig[];
  tabs: RegisterTab[];
  createdAt: number;
  updatedAt: number;
}