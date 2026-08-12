import type {
  ByteOrder32,
  ByteOrder64,
  DataDisplayFormat,
  RegisterData,
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
    case 'led': {
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
 * led: 1 bit, 16-bit formats: 16 bits, 32-bit formats: 32 bits, 64-bit: 64 bits
 */
export function getBitsPerValue(format: DataDisplayFormat): number {
  switch (format) {
    case 'led':
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
function crc16(data: Uint8Array): number {
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
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
