import type {
  ByteOrder32,
  ByteOrder64,
  DataDisplayFormat,
  RegisterData,
  RegisterTab,
} from './modbus-types';

/**
 * Reorder bytes according to byte order specification
 * For 32-bit: 4 bytes (2 registers)
 * For 64-bit: 8 bytes (4 registers)
 */
export function reorderBytes(bytes: number[], order: ByteOrder32 | ByteOrder64): number[] {
  const orderMap: Record<string, number[]> = {
    'ABCD': [0, 1, 2, 3],
    'DCBA': [3, 2, 1, 0],
    'BADC': [1, 0, 3, 2],
    'CDAB': [2, 3, 0, 1],
    'ABCDEFGH': [0, 1, 2, 3, 4, 5, 6, 7],
    'HGFEDCBA': [7, 6, 5, 4, 3, 2, 1, 0],
    'BADCFEHG': [1, 0, 3, 2, 5, 4, 7, 6],
    'GHEFCDAB': [6, 7, 4, 5, 2, 3, 0, 1],
  };

  const indices = orderMap[order];
  if (!indices) return bytes;
  return indices.map(i => bytes[i] ?? 0);
}

/**
 * 逆字节序重排：将「逻辑顺序」字节恢复为「原始寄存器顺序」字节。
 * 是 reorderBytes 的逆变换。
 */
export function reorderBytesInv(bytes: number[], order: ByteOrder32 | ByteOrder64): number[] {
  const orderMap: Record<string, number[]> = {
    'ABCD': [0, 1, 2, 3],
    'DCBA': [3, 2, 1, 0],
    'BADC': [1, 0, 3, 2],
    'CDAB': [2, 3, 0, 1],
    'ABCDEFGH': [0, 1, 2, 3, 4, 5, 6, 7],
    'HGFEDCBA': [7, 6, 5, 4, 3, 2, 1, 0],
    'BADCFEHG': [1, 0, 3, 2, 5, 4, 7, 6],
    'GHEFCDAB': [6, 7, 4, 5, 2, 3, 0, 1],
  };
  const indices = orderMap[order] ?? [];
  const out = new Array<number>(bytes.length).fill(0);
  indices.forEach((src, i) => {
    out[src] = bytes[i] ?? 0;
  });
  return out;
}

/**
 * Convert register values to bytes array
 */
export function registersToBytes(registers: number[]): number[] {
  const bytes: number[] = [];
  for (const reg of registers) {
    bytes.push((reg >> 8) & 0xff); // high byte
    bytes.push(reg & 0xff);         // low byte
  }
  return bytes;
}

/**
 * Convert bytes to 16-bit unsigned integer
 */
export function bytesToUShort(bytes: number[]): number {
  return ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
}

/**
 * Convert bytes to 16-bit signed integer
 */
export function bytesToShort(bytes: number[]): number {
  const val = bytesToUShort(bytes);
  return val > 0x7fff ? val - 0x10000 : val;
}

/**
 * Convert bytes to 32-bit signed integer
 */
export function bytesToLong(bytes: number[]): number {
  const val =
    ((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0);
  return val | 0; // ensure 32-bit signed
}

/**
 * Convert bytes to 32-bit unsigned integer
 */
export function bytesToULong(bytes: number[]): number {
  return (
    (((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0)) >>> 0
  );
}

/**
 * Convert bytes to 32-bit float (IEEE 754)
 */
export function bytesToFloat(bytes: number[]): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++) {
    view.setUint8(i, bytes[i] ?? 0);
  }
  return view.getFloat32(0);
}

/**
 * Convert bytes to 64-bit double (IEEE 754)
 */
export function bytesToDouble(bytes: number[]): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  for (let i = 0; i < 8; i++) {
    view.setUint8(i, bytes[i] ?? 0);
  }
  return view.getFloat64(0);
}

/**
 * 数值 → 大端逻辑字节序列（IEEE754 float32/float64）
 */
function numericToBigEndianBytes(value: number, double: boolean): number[] {
  const buf = new ArrayBuffer(double ? 8 : 4);
  const view = new DataView(buf);
  if (double) view.setFloat64(0, value);
  else view.setFloat32(0, value);
  return Array.from({ length: buf.byteLength }, (_, i) => view.getUint8(i));
}

/**
 * 将「格式化后的值」编码回一组 16 位寄存器原始值（用于宽类型写入）。
 * long/ulong/float 返回 2 个寄存器，double 返回 4 个；16 位及 bit 类型返回 1 个。
 */
export function encodeValueToRegisters(
  value: number,
  format: DataDisplayFormat,
  byteOrder32: ByteOrder32 = 'ABCD',
  byteOrder64: ByteOrder64 = 'ABCDEFGH',
): number[] {
  let logical: number[];
  let order: ByteOrder32 | ByteOrder64 = byteOrder32;
  switch (format) {
    case 'long': {
      const u = value | 0;
      logical = [(u >> 24) & 0xff, (u >> 16) & 0xff, (u >> 8) & 0xff, u & 0xff];
      break;
    }
    case 'ulong': {
      const u = value >>> 0;
      logical = [(u >> 24) & 0xff, (u >> 16) & 0xff, (u >> 8) & 0xff, u & 0xff];
      break;
    }
    case 'float':
      logical = numericToBigEndianBytes(value, false);
      break;
    case 'double':
      logical = numericToBigEndianBytes(value, true);
      order = byteOrder64;
      break;
    default:
      return [value & 0xffff];
  }
  const raw = reorderBytesInv(logical, order);
  const regs: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    regs.push(((raw[i] ?? 0) << 8) | (raw[i + 1] ?? 0));
  }
  return regs;
}

/**
 * Format a register value according to display format
 */
export function formatRegisterValue(
  registers: RegisterData[],
  startIndex: number,
  format: DataDisplayFormat,
  byteOrder32: ByteOrder32,
  byteOrder64: ByteOrder64
): string {
  if (startIndex >= registers.length) return '-';

  const reg = registers[startIndex];

  switch (format) {
    case 'bits': {
      // Show each bit as on/off
      const bits: string[] = [];
      for (let i = 15; i >= 0; i--) {
        bits.push((reg.rawValue >> i) & 1 ? '1' : '0');
      }
      return bits.join('');
    }
    case 'short': {
      const bytes = [((reg.rawValue >> 8) & 0xff), (reg.rawValue & 0xff)];
      return String(bytesToShort(bytes));
    }
    case 'ushort': {
      return String(reg.rawValue);
    }
    case 'hex': {
      return reg.rawValue.toString(16).toUpperCase().padStart(4, '0');
    }
    case 'binary': {
      const bits = reg.rawValue.toString(2).padStart(16, '0');
      const grouped = bits.match(/.{4}/g)?.join(' ') || bits;
      return grouped;
    }
    case 'long':
    case 'ulong':
    case 'float': {
      if (startIndex + 1 >= registers.length) return '-';
      const rawBytes = registersToBytes([
        registers[startIndex].rawValue,
        registers[startIndex + 1].rawValue,
      ]);
      const orderedBytes = reorderBytes(rawBytes, byteOrder32);
      if (format === 'long') return String(bytesToLong(orderedBytes));
      if (format === 'ulong') return String(bytesToULong(orderedBytes));
      return bytesToFloat(orderedBytes).toFixed(6);
    }
    case 'double': {
      if (startIndex + 3 >= registers.length) return '-';
      const rawBytes = registersToBytes([
        registers[startIndex].rawValue,
        registers[startIndex + 1].rawValue,
        registers[startIndex + 2].rawValue,
        registers[startIndex + 3].rawValue,
      ]);
      const orderedBytes = reorderBytes(rawBytes, byteOrder64);
      return bytesToDouble(orderedBytes).toFixed(10);
    }
    default:
      return String(reg.rawValue);
  }
}

/**
 * Get bits per value for a given display format
 * bits: 恒占 1 个寄存器（位视图），16-bit formats: 16 bits, 32-bit formats: 32 bits, 64-bit: 64 bits
 */
export function getBitsPerValue(format: DataDisplayFormat): number {
  switch (format) {
    case 'bits':
      return 1;
    case 'binary':
    case 'short':
    case 'ushort':
    case 'hex':
      return 16;
    case 'long':
    case 'ulong':
    case 'float':
      return 32;
    case 'double':
      return 64;
    default:
      return 16;
  }
}

/** 32 位 / 64 位（跨寄存器）类型集合 */
const WIDE_FORMATS: ReadonlySet<DataDisplayFormat> = new Set<DataDisplayFormat>([
  'long', 'ulong', 'float', 'double',
]);

/**
 * 标签窗口的**身份键**（R3）。
 *
 * 窗口 = 「看到的是哪一块寄存器」，由四样东西共同决定：
 *
 *    标签 id + 功能码 + 起始地址 + 寄存器数量
 *
 * ⚠️ **不要退化成"只用标签 id"**：同一个标签可以切换功能码 / 改范围去看
 * 另一块寄存器 —— 只认 id 的话，草稿会跨窗口串值（这正是 slave 侧
 * 「R1 后续修复：跨区串值」踩过的坑，主站侧一模一样）。
 *
 * ⚠️ 功能码参与身份而不只是"区域"：FC03 与 FC06 虽然都是保持寄存器，
 * 但一个是读视图、一个是写视图，窗口语义不同（数量上限、单帧限制都不同）。
 *
 * 用途：**写入草稿按窗口分桶**。草稿是"用户还没提交的编辑"，属于那个窗口 ——
 * 所以切走再切回来要还在，同时别的窗口不能看到它。
 * （注意：读取缓存/镜像的规则**相反** —— 窗口一变就该丢弃，见 ROADMAP §3.2）
 */
export function registerWindowKey(tab: RegisterTab): string {
  return `${tab.id}|${tab.functionCode}|${tab.startAddress}|${tab.registerCount}`;
}

/** 该功能码是否为"寄存器（word, 16-bit）"类型；线圈/离散输入为 bit 类型 */
export function isWordFunctionCode(functionCode: string | number): boolean {
  const fc = typeof functionCode === 'string' ? parseInt(functionCode, 10) : functionCode;
  // 03/04 读寄存器, 06/16 写寄存器
  return fc === 0x03 || fc === 0x04 || fc === 0x06 || fc === 0x10;
}

/** 某格式在"寄存器（word）"视图下占用的寄存器数量；线圈视图恒为 1 */
export function getSpanForFormat(format: DataDisplayFormat, isWordType: boolean): number {
  if (!isWordType) return 1;
  const bits = getBitsPerValue(format);
  return bits > 16 ? bits / 16 : 1;
}

/** 某地址（相对 index，从 0 起）是否有足够空间切换为指定格式 */
export function formatFitsAt(
  format: DataDisplayFormat,
  index: number,
  quantity: number,
  isWordType: boolean,
): boolean {
  const span = getSpanForFormat(format, isWordType);
  return index + span <= quantity;
}

/** 单个地址在逐行类型映射中的角色 */
export interface AddressResolution {
  /** 'start' = 分组起始地址（可设置类型）；'consumed' = 被前一宽类型占用 */
  role: 'start' | 'consumed';
  /** 所属分组的起始地址 */
  groupStart: number;
  /** 该分组实际使用的显示格式 */
  format: DataDisplayFormat;
  /** 占用的寄存器数（1 / 2 / 4） */
  span: number;
  /** 该分组是否在可用地址范围内完整放下（越界为 false） */
  fits: boolean;
  /** 该地址的类型是否为用户逐行 override（仅 start 有意义） */
  overridden: boolean;
}

/**
 * 逐行类型映射解析：从 startAddress 起按 quantity 个地址推进，
 * 依据默认格式与逐行 override 计算每个地址的角色（起点/被占用）。
 * 32 位类型占用后续 1 个地址，64 位占用后续 3 个地址；空间不足时 fits=false。
 */
export function resolveRegisterLayout(opts: {
  startAddress: number;
  quantity: number;
  isWordType: boolean;
  defaultFormat: DataDisplayFormat;
  formatOverrides?: Record<number, DataDisplayFormat>;
}): Map<number, AddressResolution> {
  const { startAddress, quantity, isWordType, defaultFormat, formatOverrides } = opts;
  const end = startAddress + quantity;
  const map = new Map<number, AddressResolution>();
  let cursor = startAddress;

  while (cursor < end) {
    const overridden = Object.prototype.hasOwnProperty.call(formatOverrides ?? {}, cursor);
    const format = (formatOverrides?.[cursor] as DataDisplayFormat | undefined) ?? defaultFormat;
    const span = getSpanForFormat(format, isWordType);
    const fits = cursor + span <= end;

    for (let s = 0; s < span && cursor + s < end; s++) {
      map.set(cursor + s, {
        role: s === 0 ? 'start' : 'consumed',
        groupStart: cursor,
        format,
        span,
        fits,
        overridden: s === 0 ? overridden : false,
      });
    }
    cursor += span;
  }

  return map;
}

export function parseDisplayValue(value: string, format: DataDisplayFormat): number {
  const trimmed = value.trim();
  switch (format) {
    case 'hex':
      // e.g. 0x"0123" or 0x0123 or 0123
      const hexStr = trimmed.replace(/^0x"?|"?$/g, '');
      return parseInt(hexStr, 16) || 0;
    case 'binary':
      // e.g. 0b"0000 0001 0010 0011" or 0b0000000000000000
      const binStr = trimmed.replace(/^0b"?|"?\s*$/g, '').replace(/\s+/g, '');
      return parseInt(binStr, 2) || 0;
    case 'float':
      return parseFloat(trimmed) || 0;
    case 'double':
      return parseFloat(trimmed) || 0;
    default:
      return parseInt(trimmed, 10) || 0;
  }
}

/**
 * Build ModBus RTU frame
 */
export function buildRTUFrame(
  slaveId: number,
  functionCode: number,
  startAddress: number,
  quantity: number
): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = slaveId & 0xff;
  frame[1] = functionCode & 0xff;
  frame[2] = (startAddress >> 8) & 0xff;
  frame[3] = startAddress & 0xff;
  frame[4] = (quantity >> 8) & 0xff;
  frame[5] = quantity & 0xff;

  // CRC16
  const crc = crc16(frame.slice(0, 6));
  frame[6] = crc & 0xff;
  frame[7] = (crc >> 8) & 0xff;

  return frame;
}

/**
 * Build ModBus ASCII frame
 */
export function buildASCIIFrame(
  slaveId: number,
  functionCode: number,
  startAddress: number,
  quantity: number
): string {
  const rtuBytes = [
    slaveId & 0xff,
    functionCode & 0xff,
    (startAddress >> 8) & 0xff,
    startAddress & 0xff,
    (quantity >> 8) & 0xff,
    quantity & 0xff,
  ];

  const lrcVal = lrc(rtuBytes);
  const fullBytes = [...rtuBytes, lrcVal];
  const asciiStr = fullBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  return ':' + asciiStr + '\r\n';
}

/**
 * CRC16 calculation for RTU mode
 */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}

/**
 * LRC calculation for ASCII mode
 */
function lrc(data: number[]): number {
  let sum = 0;
  for (const byte of data) {
    sum = (sum + byte) & 0xff;
  }
  return ((0x100 - sum) & 0xff);
}

/**
 * Format bytes to hex string
 */
export function toHexString(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  return arr.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}
