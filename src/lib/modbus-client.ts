// ModBus 客户端协议层（基于 modbus-serial 库）
// 支持 TCP + Serial（RTU/ASCII），广播（slaveId=0）仅写操作
import ModbusRTU from 'modbus-serial';
import type { ConnectionConfig, ModbusResponse } from './modbus-types';
import { isBroadcastSlave } from './modbus-types';

/** 默认响应超时（毫秒） */
const DEFAULT_TIMEOUT = 2000;
/** 广播写入超时（毫秒）：广播无响应，需短超时避免长时间等待 */
const BROADCAST_TIMEOUT = 300;

/**
 * 从任意未知异常中提取可读的错误信息。
 * modbus-serial 的部分错误（如 TransactionTimedOutError）不是标准 Error 实例，
 * 直接 String(err) 会得到 "[object Object]"。
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as { message?: unknown; errno?: unknown; name?: unknown; code?: unknown };
    const msg = obj.message ?? obj.errno ?? obj.code ?? obj.name;
    if (typeof msg === 'string' && msg.trim() !== '') return msg;
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch {
      /* ignore */
    }
  }
  return String(err);
}

/** 活跃客户端连接表 */
const clients = new Map<string, ModbusRTU>();

/** 「对端掉线」钩子的清理函数表（key = connectionId），断开/重连前必须清理 */
const lostHooks = new Map<string, () => void>();

/** 连接生命周期回调 */
export interface ConnectHandlers {
  /**
   * 对端（从站）断开时触发：底层 socket 的 `close` 或 `error`。
   * ⚠️ 由服务端主动 `close()`（手动断开）时**不会**触发 —— 那时钩子已被摘掉。
   */
  onLost?: (reason: string) => void;
}

/** 底层 socket 的最小结构（只取我们用到的事件方法） */
interface SocketLike {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
}

/**
 * 把「对端 socket 关闭 / 出错」这一步接出来。
 *
 * ⚠️ **为什么不能直接用 `client.on('close')`**：
 * modbus-serial 8.x 的 TCP 端口（`ports/tcpport.js`）在 socket `error` 时**先把内部的
 * `openFlag` 置为 false**，紧接着到来的 socket `close` 事件因 `if (self.openFlag)` 不成立，
 * **不再向上 `emit('close')`** ⇒ 对端掉线（ECONNRESET / EPIPE / 拔网线 / 从站进程退出）时
 * 上层监听器什么也收不到，连接状态会永远停在 `connected`。
 * 因此这里直接挂在底层 `net.Socket` 上 —— 那是本版本库唯一可靠的入口。
 * 若将来库改内部字段导致取不到，静默退化为「无对端监测」，不影响连接本身可用。
 */
function attachLostHooks(
  connectionId: string,
  client: ModbusRTU,
  onLost: (reason: string) => void,
): void {
  const port = (client as unknown as { _port?: { _client?: unknown } })._port;
  const socket = port?._client as SocketLike | undefined;
  if (!socket || typeof socket.on !== 'function' || typeof socket.removeListener !== 'function') {
    return;
  }

  let fired = false;
  const fire = (reason: string) => {
    // `close` 与 `error` 常结伴而来（error → close），只报一次
    if (fired) return;
    fired = true;
    lostHooks.delete(connectionId);
    onLost(reason);
  };
  const onClose = () => fire('对端关闭了连接');
  const onError = (err: unknown) => fire(`对端连接异常：${toErrorMessage(err)}`);

  socket.on('close', onClose);
  socket.on('error', onError);
  lostHooks.set(connectionId, () => {
    socket.removeListener('close', onClose);
    socket.removeListener('error', onError);
  });
}

/** 获取客户端实例 */
export function getClient(connectionId: string): ModbusRTU | undefined {
  return clients.get(connectionId);
}

/** 建立连接 */
export async function connectClient(
  connectionId: string,
  config: ConnectionConfig,
  handlers: ConnectHandlers = {},
): Promise<void> {
  // 防止重复连接泄漏：先关闭同 ID 的旧客户端
  await disconnectClient(connectionId);

  const client = new ModbusRTU();
  try {
    if (config.protocol === 'tcp') {
      const host = config.tcpConfig?.host || '127.0.0.1';
      const port = config.tcpConfig?.port || 502;
      await client.connectTCP(host, { port });
    } else if (config.protocol === 'serial') {
      const sc = config.serialConfig;
      const opts = {
        baudRate: sc?.baudRate ?? 9600,
        dataBits: sc?.dataBits ?? 8,
        stopBits: sc?.stopBits ?? 1,
        parity: sc?.parity ?? 'none',
      };
      const port = sc?.port || '/dev/ttyUSB0';
      if (config.mode === 'ascii') {
        await client.connectAsciiSerial(port, opts);
      } else {
        await client.connectRTUBuffered(port, opts);
      }
    } else {
      throw new Error(`Unsupported protocol: ${config.protocol}`);
    }
    client.setTimeout(DEFAULT_TIMEOUT);
    clients.set(connectionId, client);
    if (handlers.onLost) attachLostHooks(connectionId, client, handlers.onLost);
  } catch (err) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** 断开连接 */
export async function disconnectClient(connectionId: string): Promise<void> {
  // ⭐ 先摘掉对端监测，否则这次**主动**关闭会被当成"对端掉线"回调出去
  lostHooks.get(connectionId)?.();
  lostHooks.delete(connectionId);

  const client = clients.get(connectionId);
  if (client) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    clients.delete(connectionId);
  }
}

/** 断开所有连接 */
export async function disconnectAllClients(): Promise<void> {
  const ids = [...clients.keys()];
  for (const id of ids) {
    await disconnectClient(id);
  }
}

/** 读取寄存器（FC01/02/03/04） */
export async function readRegisters(
  connectionId: string,
  slaveId: number,
  functionCode: number,
  startAddress: number,
  quantity: number,
): Promise<ModbusResponse> {
  const client = clients.get(connectionId);
  if (!client) {
    return { success: false, rawTx: '', rawRx: '', error: 'Not connected' };
  }
  client.setID(slaveId);
  client.setTimeout(DEFAULT_TIMEOUT);
  const started = Date.now();
  try {
    let data: number[] = [];
    switch (functionCode) {
      case 0x01:
        data = ((await client.readCoils(startAddress, quantity)).data as boolean[]).map(b => b ? 1 : 0);
        break;
      case 0x02:
        data = ((await client.readDiscreteInputs(startAddress, quantity)).data as boolean[]).map(b => b ? 1 : 0);
        break;
      case 0x03:
        data = (await client.readHoldingRegisters(startAddress, quantity)).data;
        break;
      case 0x04:
        data = (await client.readInputRegisters(startAddress, quantity)).data;
        break;
      default:
        return { success: false, rawTx: '', rawRx: '', error: `Unsupported read FC: ${functionCode}` };
    }
    return { success: true, data, rawTx: '', rawRx: '', timing: Date.now() - started };
  } catch (err) {
    return { success: false, rawTx: '', rawRx: '', error: toErrorMessage(err), timing: Date.now() - started };
  }
}

/** 写入（FC05/06/15/16），支持广播（slaveId=0）；values 统一为 number[]，布尔转换在函数内完成 */
export async function writeRegisters(
  connectionId: string,
  slaveId: number,
  functionCode: number,
  startAddress: number,
  values: number[],
): Promise<ModbusResponse> {
  const client = clients.get(connectionId);
  if (!client) {
    return { success: false, rawTx: '', rawRx: '', error: 'Not connected' };
  }
  const broadcast = isBroadcastSlave(slaveId);
  client.setID(slaveId);
  // 广播无响应，用短超时；否则正常超时
  client.setTimeout(broadcast ? BROADCAST_TIMEOUT : DEFAULT_TIMEOUT);
  const started = Date.now();
  try {
    switch (functionCode) {
      case 0x05:
        await client.writeCoil(startAddress, Boolean(values[0]));
        break;
      case 0x06:
        await client.writeRegister(startAddress, Number(values[0]));
        break;
      case 0x0f:
        await client.writeCoils(startAddress, values.map((v) => Boolean(v)));
        break;
      case 0x10:
        await client.writeRegisters(startAddress, values.map((v) => Number(v)));
        break;
      default:
        return { success: false, rawTx: '', rawRx: '', error: `Unsupported write FC: ${functionCode}` };
    }
    return { success: true, rawTx: '', rawRx: '', timing: Date.now() - started, broadcast };
  } catch (err) {
    const errMsg = toErrorMessage(err);
    // 广播写入无响应：超时视为已发送成功
    if (broadcast && /timeout/i.test(errMsg)) {
      return { success: true, rawTx: '', rawRx: '', timing: Date.now() - started, broadcast };
    }
    return { success: false, rawTx: '', rawRx: '', error: errMsg, timing: Date.now() - started, broadcast };
  }
}
