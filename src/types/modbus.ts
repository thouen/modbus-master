export interface ConnectionConfig {
  host: string;
  port: number;
  unitId: number;
  timeout?: number;
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
}

export interface PollConfig {
  functionCode: number;
  address: number;
  quantity: number;
  interval: number;
}
