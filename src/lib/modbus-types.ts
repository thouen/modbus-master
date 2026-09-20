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
  | 'bits'       // 16-bit 位视图（一行 = 一个寄存器的 16 个位）
  | 'short'      // 16-bit signed
  | 'ushort'     // 16-bit unsigned
  | 'hex'        // 16-bit hexadecimal
  | 'binary'     // 16-bit binary
  | 'long'       // 32-bit signed integer
  | 'ulong'      // 32-bit unsigned integer
  | 'float'      // 32-bit float
  | 'double';    // 64-bit double

// ── 寄存器区域（Q20：全项目以「寄存器」为单位） ──

/**
 * 四个寄存器区域。
 *
 * ⭐ **每个区是一条独立的地址空间** —— "地址 0" 在四个区里是四个不同的单元，
 * 不存在共享。主站侧每 `RegisterArea` 对应一条 `Uint16Array`（见 `ConnectionRegisterImage`）。
 */
export type RegisterArea = 'coils' | 'discreteInputs' | 'holdingRegisters' | 'inputRegisters';

/** 位（1 bit）区域：线圈 / 离散输入 */
export function isBitArea(area: RegisterArea): boolean {
  return area === 'coils' || area === 'discreteInputs';
}

/** 字（16 bit）区域：保持寄存器 / 输入寄存器 */
export function isWordArea(area: RegisterArea): boolean {
  return area === 'holdingRegisters' || area === 'inputRegisters';
}

/** 一个寄存器 = 16 个位地址（Q19：全系统统一以「寄存器」为单位） */
export const BITS_PER_REGISTER = 16;

/** 四个区的遍历顺序（用于建立/克隆镜像，保持稳定输出） */
export const REGISTER_AREAS: readonly RegisterArea[] = [
  'coils',
  'discreteInputs',
  'holdingRegisters',
  'inputRegisters',
];

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

/**
 * 功能码 → 它操作的**寄存器区域**。
 *
 * ⭐ 这是主站侧把"响应数据"归位到镜像哪条数组的判据：
 * 位区功能码（FC01/02/05/15）与字区功能码（FC03/04/06/16）指的不是同一片内存。
 */
export function fcToArea(fc: number | string): RegisterArea | null {
  const code = typeof fc === 'string' ? parseInt(fc, 10) : fc;
  switch (code) {
    case MODBUS_FC.READ_COILS:
    case MODBUS_FC.WRITE_SINGLE_COIL:
    case MODBUS_FC.WRITE_MULTIPLE_COILS:
      return 'coils';
    case MODBUS_FC.READ_DISCRETE_INPUTS:
      return 'discreteInputs';
    case MODBUS_FC.READ_HOLDING_REGISTERS:
    case MODBUS_FC.WRITE_SINGLE_REGISTER:
    case MODBUS_FC.WRITE_MULTIPLE_REGISTERS:
      return 'holdingRegisters';
    case MODBUS_FC.READ_INPUT_REGISTERS:
      return 'inputRegisters';
    default:
      return null;
  }
}

/**
 * 「寄存器」单位 → 线上 ModBus「地址」单位（Q19 / Q20）。
 *
 * ⭐ 这是全项目位区**唯一**一处 ×16 换算：
 * - 字区（保持 / 输入寄存器）：1 寄存器 = 1 地址，原样返回；
 * - 位区（线圈 / 离散输入）：1 寄存器 = 16 个位地址。
 *
 * ⚠️ UI / 状态 / 内部一律用**寄存器**单位；只有落到协议请求与响应解析时才经此换算。
 * 不要把这个 ×16 散落到调用点。
 */
export function registerSpanToAddressSpan(
  area: RegisterArea,
  registerStart: number,
  registerCount: number,
): { start: number; count: number } {
  if (!isBitArea(area)) return { start: registerStart, count: registerCount };
  return {
    start: registerStart * BITS_PER_REGISTER,
    count: registerCount * BITS_PER_REGISTER,
  };
}

/**
 * 「按位打包的寄存器字」→ 协议要的「每位一个 0/1」序列。
 *
 * ⭐ 与 {@link registerSpanToAddressSpan} 配对使用：内部一律按"寄存器 + 打包字"，
 * 只有落到 FC05/15 的 `values` 时才展开。
 *
 * ⚠️ 位序：字内 **bit 0（LSB）= 编号最小的位地址**，
 * 所以展开后第 1 个元素对应起始位地址（与协议"首线圈在字节最低位"一致）。
 */
export function expandPackedBitWords(words: number[], bitCount: number): number[] {
  const out: number[] = [];
  for (const word of words) {
    for (let bit = 0; bit < BITS_PER_REGISTER; bit++) {
      out.push((word >> bit) & 1);
    }
  }
  return out.slice(0, Math.max(0, bitCount));
}

/**
 * {@link expandPackedBitWords} 的**逆变换**：协议响应的「每位一个 0/1」（FC01/02）
 * → 按位打包的寄存器字。
 *
 * 位序同上：序列第 1 个元素（编号最小的位地址）落在字的 **bit 0**。
 */
export function packBitsToWords(bits: number[]): number[] {
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += BITS_PER_REGISTER) {
    let word = 0;
    for (let bit = 0; bit < BITS_PER_REGISTER; bit++) {
      if (bits[i + bit]) word |= 1 << bit;
    }
    words.push(word >>> 0);
  }
  return words;
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
  /**
   * 线圈区**总寄存器数量**（= 文档/讨论用语里的该区 `areaTotalRegisters`）。
   * 位区按寄存器计量 ⇒ 有效位地址范围 `[0, coilCount × 16 − 1]`。
   * 字段名与 slave 侧保持一致（Q17：只改语义与文案，不改名）。
   *
   * ⚠️ 主站侧这只是**镜像数组的初始长度**，不是"设备一定只有这么多" ——
   * 收到超出该长度的响应时会自动扩容（主站数组本质是接收缓冲区，见 ROADMAP §3.6）。
   */
  coilCount: number;
  /** 离散输入区总寄存器数量（FC02）⇒ 有效位地址范围 `[0, discreteInputCount × 16 − 1]` */
  discreteInputCount: number;
  /** 保持寄存器区总寄存器数量（FC03/06/16）⇒ 有效地址范围 `[0, holdingRegisterCount − 1]` */
  holdingRegisterCount: number;
  /** 输入寄存器区总寄存器数量（FC04）⇒ 有效地址范围 `[0, inputRegisterCount − 1]` */
  inputRegisterCount: number;
  /**
   * ⭐ 32 位值（long / ulong / float）的字节序 —— **连接级设备属性**，唯一数据源。
   * 引用该连接的**所有标签**共用这一份值（标签侧只读显示，见 `RegisterTab`）。
   */
  byteOrder32: ByteOrder32;
  /**
   * ⭐ 64 位值（double）的字节序 —— **连接级设备属性**，唯一数据源。
   * 作用范围：`long` / `ulong` / `float` 读 `byteOrder32`，`double` 读 `byteOrder64`；
   * **16 位五个格式（bits / short / ushort / hex / binary）两个都不读，固定大端**。
   */
  byteOrder64: ByteOrder64;
}

/** 一个区在连接配置里声明的「总寄存器数量」默认值（下限 1） */
export const DEFAULT_AREA_TOTAL_REGISTERS = 1000;

/** 区域总寄存器数量的下界为 1（零长数组会让"数组越界"不再等价于"声明范围越界"） */
export function normalizeAreaTotal(areaTotalRegisters: number): number {
  const n = Math.floor(areaTotalRegisters);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * 取连接配置里某区声明的**总寄存器数量**。
 * （概念名 = `areaTotalRegisters`；代码字段名保持 `coilCount` 等 4 个历史名）
 */
export function areaTotalRegistersFor(config: ConnectionConfig, area: RegisterArea): number {
  switch (area) {
    case 'coils':
      return normalizeAreaTotal(config.coilCount);
    case 'discreteInputs':
      return normalizeAreaTotal(config.discreteInputCount);
    case 'holdingRegisters':
      return normalizeAreaTotal(config.holdingRegisterCount);
    case 'inputRegisters':
      return normalizeAreaTotal(config.inputRegisterCount);
  }
}

/** 给（可能缺字段的）旧配置补齐 4 个区域总量字段 */
export function withAreaTotals(config: ConnectionConfig): ConnectionConfig {
  return {
    ...config,
    coilCount: normalizeAreaTotal(config.coilCount ?? DEFAULT_AREA_TOTAL_REGISTERS),
    discreteInputCount: normalizeAreaTotal(config.discreteInputCount ?? DEFAULT_AREA_TOTAL_REGISTERS),
    holdingRegisterCount: normalizeAreaTotal(config.holdingRegisterCount ?? DEFAULT_AREA_TOTAL_REGISTERS),
    inputRegisterCount: normalizeAreaTotal(config.inputRegisterCount ?? DEFAULT_AREA_TOTAL_REGISTERS),
  };
}

export interface RegisterTab {
  id: string;
  name: string;
  connectionId: string;
  /** ⭐ 「寄存器」单位（Q19）：从第几个寄存器开始看 */
  startAddress: number;
  /**
   * ⭐ 「寄存器」单位（Q19，原字段名 `quantity`）：覆盖几个寄存器。
   * 四个区同一含义 —— 位区 1 个寄存器 = 16 个位地址；
   * 落到线协议时位区才 `× 16`（见 `registerSpanToAddressSpan`）。
   */
  registerCount: number;
  functionCode: FunctionCode;
  pollInterval: number; // ms
  displayFormat: DataDisplayFormat;
  /** 逐行类型映射：起始地址 -> 该行的显示格式（覆盖标签默认 displayFormat）。
   *  仅记录分组起始地址；32/64 位类型占用的后续地址不在此表中。 */
  formatOverrides?: Record<number, DataDisplayFormat>;
  // ⭐ 字节序**不在标签上** —— 它是**设备属性**，归 `ConnectionConfig`（见 R3：
  //    "值归连接，标签只是视图"；字节序决定同一份字节怎么解释，必须与值同归一处）。
  //    标签侧只**只读显示**当前生效值，不持有、不可改。
  // ⚠️ 16 位寄存器（bits/short/ushort/hex/binary）**固定大端**（ModBus 规范），
  //    与这两种字节序无关。
  isPolling: boolean;
}

/** 值的来源（Q7）：主站读回 / 界面手动编辑 / 值生成器（R2 预留） */
export type ValueSource = 'master' | 'manual' | 'generator';

/** 值来源的内部编码（每寄存器 1 byte；0 = 从未写入，即初值） */
export const SOURCE_CODE: Record<ValueSource, number> = {
  master: 1,
  manual: 2,
  generator: 3,
};

/** 编码 → 来源名；`0` / 未知编码 → `null`（= 初值，界面不显示角标） */
export function decodeSource(code: number): ValueSource | null {
  switch (code) {
    case SOURCE_CODE.master:
      return 'master';
    case SOURCE_CODE.manual:
      return 'manual';
    case SOURCE_CODE.generator:
      return 'generator';
    default:
      return null;
  }
}

export interface RegisterData {
  /** ⭐ **寄存器序号**（Q20：地址一律按寄存器编号显示；位区 1 = 16 个位地址） */
  address: number;
  /** 16 位无符号原始值；位区为**按位打包的 16 位字**（1 字 = 16 个位地址） */
  rawValue: number;
  /** 值来源（Q7）；`null` / 缺省 = 从未写入（初值） */
  source?: ValueSource | null;
}

/**
 * 主站侧的**连接设备镜像**（R3）。
 *
 * ⭐ 与 slave 内存的关键区别：**这本质是"接收数据的缓冲区"，不是"设备的真实内存"**。
 * 所以它可以在收到更远的地址时**自动扩容**，而 slave 的内存长度永远等于声明范围。
 *
 * ⚠️ 归属层级是**连接**（`connectionId`），不是标签：同一个物理寄存器
 * 在所有引用该连接的标签里看到的必须是**同一份值**。标签只是视图。
 *
 * ⚠️ **手动编辑（草稿）不进这里** —— 镜像只在三种情况下被改写：
 * ①主站读回 ②写入成功确认 ③生成器（R2）。否则轮询读回会冲掉用户尚未提交的草稿。
 */
export interface ConnectionRegisterImage {
  connectionId: string;
  /**
   * 4 条数组，初始长度 = 该连接声明的 `areaTotalRegisters`。
   * 位区**按位打包**（1 字 = 16 个位地址，字内 bit 0 = 编号最小的位地址）。
   */
  areas: Record<RegisterArea, Uint16Array>;
  /** 逐**寄存器**的值来源，索引与 `areas` 一一对应 */
  sources: Record<RegisterArea, Uint8Array>;
  /** 逐**寄存器**的最后更新时间戳（ms）；0 = 从未写入 */
  updatedAt: Record<RegisterArea, Float64Array>;
  /**
   * 版本号。数组是**就地改写**的（`Uint16Array` 无法廉价地按值比较），
   * 因此每次真实变更都 +1，供 React 判断"这份镜像变了"。
   */
  version: number;
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