// ModBus Protocol Types

export type Protocol = 'serial' | 'tcp' | 'udp';
export type Mode = 'ascii' | 'rtu';
export type FunctionCode = '01' | '02' | '03' | '04' | '05' | '06' | '15' | '16';

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

export interface UdpConfig {
  host: string;
  port: number;
  localPort: number;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  protocol: Protocol;
  mode: Mode;
  serialConfig?: SerialConfig;
  tcpConfig?: TcpConfig;
  udpConfig?: UdpConfig;
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
  bitCount: number;
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