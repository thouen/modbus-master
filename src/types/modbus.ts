export type ModbusProtocol = 'tcp' | 'udp' | 'rtu_tcp';
export type DisplayFormat = 'hex' | 'dec' | 'bin' | 'flt';
export type ByteOrder = 'LE' | 'BE';

export interface ConnectionConfig {
  host: string;
  port: number;
  unitId: number;
  timeout?: number;
  protocol?: ModbusProtocol;
}

export interface ConnectionStatus {
  connected: boolean;
  config: ConnectionConfig | null;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'connect' | 'disconnect' | 'read' | 'write' | 'error';
  functionCode?: number;
  address?: number;
  quantity?: number;
  values?: number[] | boolean[];
  message: string;
  success: boolean;
}

export interface ReadResult {
  id: string;
  timestamp: number;
  functionCode: number;
  address: number;
  quantity: number;
  values: number[] | boolean[];
  name: string;
  startAddr: number;
  data: number[] | boolean[];
}

export interface PollConfig {
  functionCode: number;
  address: number;
  quantity: number;
  interval: number;
}

export interface SavedConnection extends ConnectionConfig {
  id: string;
  name: string;
}
