import ModbusRTU from 'modbus-serial';

export interface ModbusConnectionConfig {
  host: string;
  port: number;
  unitId: number;
  timeout?: number;
}

export interface ModbusLogEntry {
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

class ModbusClientManager {
  private client: ModbusRTU | null = null;
  private connected = false;
  private config: ModbusConnectionConfig | null = null;
  private logs: ModbusLogEntry[] = [];
  private maxLogs = 500;

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private addLog(entry: Omit<ModbusLogEntry, 'id' | 'timestamp'>): ModbusLogEntry {
    const log: ModbusLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now(),
    };
    this.logs.unshift(log);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    return log;
  }

  getStatus() {
    return {
      connected: this.connected,
      config: this.config,
    };
  }

  getLogs(limit = 100, offset = 0) {
    return {
      logs: this.logs.slice(offset, offset + limit),
      total: this.logs.length,
    };
  }

  clearLogs() {
    this.logs = [];
  }

  async connect(config: ModbusConnectionConfig): Promise<ModbusLogEntry> {
    // Clean up previous connection before establishing a new one
    if (this.connected && this.client) {
      await this.disconnect();
    }

    const newClient = new ModbusRTU();
    newClient.setID(config.unitId);
    newClient.setTimeout(config.timeout || 5000);

    try {
      await newClient.connectTCP(config.host, { port: config.port });
      this.client = newClient;
      this.connected = true;
      this.config = { ...config };

      return this.addLog({
        type: 'connect',
        message: `Connected to ${config.host}:${config.port} (Unit ID: ${config.unitId})`,
        success: true,
      });
    } catch (error) {
      // Clean up the failed client to avoid socket leaks
      try {
        newClient.close(() => {});
      } catch {
        // ignore close errors on failed client
      }
      this.connected = false;
      this.config = null;
      this.client = null;

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return this.addLog({
        type: 'error',
        message: `Connection failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async disconnect(): Promise<ModbusLogEntry> {
    if (this.client) {
      const clientToClose = this.client;
      this.client = null;
      this.connected = false;
      const prevConfig = this.config;
      this.config = null;

      // Wrap callback-based close() in a Promise for proper async handling
      await new Promise<void>((resolve) => {
        try {
          clientToClose.close(() => {
            resolve();
          });
        } catch {
          resolve();
        }
      });

      return this.addLog({
        type: 'disconnect',
        message: `Disconnected from ${prevConfig?.host || 'unknown'}:${prevConfig?.port || 'unknown'}`,
        success: true,
      });
    }

    this.connected = false;
    const prevConfig = this.config;
    this.config = null;

    return this.addLog({
      type: 'disconnect',
      message: `Disconnected from ${prevConfig?.host || 'unknown'}:${prevConfig?.port || 'unknown'}`,
      success: true,
    });
  }

  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to any Modbus device');
    }
  }

  async readCoils(address: number, quantity: number): Promise<{ data: boolean[]; log: ModbusLogEntry }> {
    this.ensureConnected();
    try {
      const result = await this.client!.readCoils(address, quantity);
      const data = result.data as unknown as boolean[];
      return {
        data,
        log: this.addLog({
          type: 'read',
          functionCode: 1,
          address,
          quantity,
          values: data,
          message: `Read Coils (FC01): Address ${address}, Quantity ${quantity}`,
          success: true,
        }),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 1,
        address,
        quantity,
        message: `Read Coils failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async readDiscreteInputs(address: number, quantity: number): Promise<{ data: boolean[]; log: ModbusLogEntry }> {
    this.ensureConnected();
    try {
      const result = await this.client!.readDiscreteInputs(address, quantity);
      const data = result.data as unknown as boolean[];
      return {
        data,
        log: this.addLog({
          type: 'read',
          functionCode: 2,
          address,
          quantity,
          values: data,
          message: `Read Discrete Inputs (FC02): Address ${address}, Quantity ${quantity}`,
          success: true,
        }),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 2,
        address,
        quantity,
        message: `Read Discrete Inputs failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async readHoldingRegisters(address: number, quantity: number): Promise<{ data: number[]; log: ModbusLogEntry }> {
    this.ensureConnected();
    try {
      const result = await this.client!.readHoldingRegisters(address, quantity);
      const data = result.data as number[];
      return {
        data,
        log: this.addLog({
          type: 'read',
          functionCode: 3,
          address,
          quantity,
          values: data,
          message: `Read Holding Registers (FC03): Address ${address}, Quantity ${quantity}`,
          success: true,
        }),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 3,
        address,
        quantity,
        message: `Read Holding Registers failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async readInputRegisters(address: number, quantity: number): Promise<{ data: number[]; log: ModbusLogEntry }> {
    this.ensureConnected();
    try {
      const result = await this.client!.readInputRegisters(address, quantity);
      const data = result.data as number[];
      return {
        data,
        log: this.addLog({
          type: 'read',
          functionCode: 4,
          address,
          quantity,
          values: data,
          message: `Read Input Registers (FC04): Address ${address}, Quantity ${quantity}`,
          success: true,
        }),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 4,
        address,
        quantity,
        message: `Read Input Registers failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async writeSingleCoil(address: number, value: boolean): Promise<ModbusLogEntry> {
    this.ensureConnected();
    try {
      await this.client!.writeCoil(address, value);
      return this.addLog({
        type: 'write',
        functionCode: 5,
        address,
        quantity: 1,
        values: [value],
        message: `Write Single Coil (FC05): Address ${address}, Value ${value}`,
        success: true,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 5,
        address,
        message: `Write Single Coil failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async writeSingleRegister(address: number, value: number): Promise<ModbusLogEntry> {
    this.ensureConnected();
    // Sanitize: clamp to uint16 range
    const sanitized = Math.max(0, Math.min(65535, Math.round(value)));
    try {
      await this.client!.writeRegister(address, sanitized);
      return this.addLog({
        type: 'write',
        functionCode: 6,
        address,
        quantity: 1,
        values: [sanitized],
        message: `Write Single Register (FC06): Address ${address}, Value ${sanitized}`,
        success: true,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 6,
        address,
        message: `Write Single Register failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async writeMultipleCoils(address: number, values: boolean[]): Promise<ModbusLogEntry> {
    this.ensureConnected();
    // Sanitize: ensure all values are proper booleans
    const sanitized = values.map((v) => Boolean(v));
    try {
      await this.client!.writeCoils(address, sanitized);
      return this.addLog({
        type: 'write',
        functionCode: 15,
        address,
        quantity: sanitized.length,
        values: sanitized,
        message: `Write Multiple Coils (FC15): Address ${address}, Count ${sanitized.length}`,
        success: true,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 15,
        address,
        message: `Write Multiple Coils failed: ${errMsg}`,
        success: false,
      });
    }
  }

  async writeMultipleRegisters(address: number, values: number[]): Promise<ModbusLogEntry> {
    this.ensureConnected();
    // Sanitize: filter NaN/Infinity, clamp to uint16 range to prevent buffer length mismatch
    const sanitized = values
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.max(0, Math.min(65535, Math.round(v))));
    if (sanitized.length === 0) {
      throw this.addLog({
        type: 'error',
        functionCode: 16,
        address,
        quantity: values.length,
        values,
        message: 'Write Multiple Registers failed: No valid values provided',
        success: false,
      });
    }
    try {
      await this.client!.writeRegisters(address, sanitized);
      return this.addLog({
        type: 'write',
        functionCode: 16,
        address,
        quantity: sanitized.length,
        values: sanitized,
        message: `Write Multiple Registers (FC16): Address ${address}, Count ${sanitized.length}`,
        success: true,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      throw this.addLog({
        type: 'error',
        functionCode: 16,
        address,
        quantity: sanitized.length,
        values: sanitized,
        message: `Write Multiple Registers failed: ${errMsg}`,
        success: false,
      });
    }
  }
}

// Singleton
const globalForModbus = globalThis as unknown as {
  modbusManager: ModbusClientManager | undefined;
};

export const modbusManager = globalForModbus.modbusManager ?? new ModbusClientManager();

if (process.env.NODE_ENV !== 'production') {
  globalForModbus.modbusManager = modbusManager;
}
