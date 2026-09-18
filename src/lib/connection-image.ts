// 主站侧「连接设备镜像」内核（R3）
//
// 职责：把一段「线上响应」写进镜像、把镜像按寄存器读出来给表格用。
//
// ⭐ 三件事只在这里做，别散到调用点：
//   1. 位区的**按位打包 / 解包**（字内 bit 0 = 编号最小的位地址）
//   2. 镜像的**自动扩容**（主站数组是接收缓冲区，可以变长）
//   3. 「寄存器序号」与「数组下标」的对应

import {
  BITS_PER_REGISTER,
  REGISTER_AREAS,
  areaTotalRegistersFor,
  decodeSource,
  isBitArea,
  type ConnectionConfig,
  type ConnectionRegisterImage,
  type RegisterArea,
  type RegisterData,
  type ValueSource,
  SOURCE_CODE,
} from './modbus-types';

/**
 * ModBus 地址空间上限：`0 ~ 65535`，共 65536 个地址。
 * 扩容不会越过这个上限（越界读本来就应该由从站回 `0x02`）。
 */
export const ADDRESS_SPACE = 65536;

/** 把 16 位字里**字内第 `bit` 位**设为 `value` 后的新字（纯函数） */
export function withBitSet(word: number, bit: number, value: boolean): number {
  const mask = 1 << (bit & (BITS_PER_REGISTER - 1));
  return value ? word | mask : word & ~mask;
}

/**
 * 从按位打包的字数组中读一个**位地址**。
 * ⚠️ 位序：字内 bit 0（LSB）= 编号最小的位地址（与协议"首线圈在字节最低位"一致）。
 */
export function readPackedBit(words: Uint16Array, bitAddress: number): boolean {
  const word = words[bitAddress >> 4] ?? 0;
  return ((word >> (bitAddress & 0xf)) & 1) !== 0;
}

/**
 * 新建一份连接镜像：4 条 `Uint16Array`，长度 = 该区声明的 `areaTotalRegisters`。
 * 位区同样只分配 `areaTotalRegisters` 个**字**（每字打包 16 个位地址），省 8 倍内存。
 */
export function createConnectionImage(
  connectionId: string,
  config: ConnectionConfig,
): ConnectionRegisterImage {
  const areas = {} as Record<RegisterArea, Uint16Array>;
  const sources = {} as Record<RegisterArea, Uint8Array>;
  const updatedAt = {} as Record<RegisterArea, Float64Array>;

  for (const area of REGISTER_AREAS) {
    const total = areaTotalRegistersFor(config, area);
    areas[area] = new Uint16Array(total);
    sources[area] = new Uint8Array(total);
    updatedAt[area] = new Float64Array(total);
  }

  return { connectionId, areas, sources, updatedAt, version: 0 };
}

/**
 * 克隆镜像用于不可变更新。
 *
 * ⚠️ `areas` 是 `TypedArray`，React 无法廉价地按值比较，所以这里**浅拷一份对象 +
 * 克隆被改的那条数组**由调用方决定。默认全量克隆（4 条数组 ≈ 8 KB），
 * 在"每秒若干次"的轮询节奏下开销可忽略，换来的是明确的不可变语义。
 */
export function cloneImage(image: ConnectionRegisterImage): ConnectionRegisterImage {
  const areas = {} as Record<RegisterArea, Uint16Array>;
  const sources = {} as Record<RegisterArea, Uint8Array>;
  const updatedAt = {} as Record<RegisterArea, Float64Array>;

  for (const area of REGISTER_AREAS) {
    areas[area] = new Uint16Array(image.areas[area]);
    sources[area] = new Uint8Array(image.sources[area]);
    updatedAt[area] = new Float64Array(image.updatedAt[area]);
  }

  return { ...image, areas, sources, updatedAt };
}

/** 某区当前已分配的**寄存器**容量（位区即字数） */
export function areaCapacity(image: ConnectionRegisterImage, area: RegisterArea): number {
  return image.areas[area].length;
}

/**
 * 确保某区容量 ≥ `requiredRegisters` 个寄存器；不足则**扩容**。
 *
 * ⭐ 为什么主站要能扩容（而 slave 不能）：
 * 主站连接 count 设 100（你声明"这设备只有 100 个寄存器"），但你去读地址 500
 * （真实设备其实有 1000 个）—— 设备会**正常返回** 500 处的值，
 * 而你**没有 500 号格子可以放它**。缓冲区可以变长，设备的存储不会。
 *
 * 扩容策略：`min(地址空间上限, max(需要量, 现长 × 2))` —— 倍增摊薄反复拷贝，
 * 但不会把内存撑到 65536（除非真的读到了那么远）。
 *
 * 返回**是否发生了扩容**（调用方据此记一条日志）。
 */
export function ensureImageCapacity(
  image: ConnectionRegisterImage,
  area: RegisterArea,
  requiredRegisters: number,
): boolean {
  const current = image.areas[area].length;
  if (requiredRegisters <= current) return false;

  const target = Math.min(ADDRESS_SPACE, Math.max(requiredRegisters, current * 2));

  const nextAreas = new Uint16Array(target);
  nextAreas.set(image.areas[area]);
  image.areas[area] = nextAreas;

  const nextSources = new Uint8Array(target);
  nextSources.set(image.sources[area]);
  image.sources[area] = nextSources;

  const nextUpdatedAt = new Float64Array(target);
  nextUpdatedAt.set(image.updatedAt[area]);
  image.updatedAt[area] = nextUpdatedAt;

  return true;
}

export interface ApplyResult {
  /** 是否发生了扩容 */
  grown: boolean;
  /** 实际写入的寄存器数量 */
  written: number;
}

/**
 * 把一段数据写入镜像。
 *
 * ⭐ **口径统一**（Q20 精神）：
 * - `startRegister` 一律是**寄存器序号**；
 * - `values` 一律是**「每寄存器一个字」**的数组（位区也是打包好的字，长度 = 寄存器数）。
 *
 * 所以位区**不需要**在这里知道"位地址"这件事 —— 协议响应是"每位一个 0/1"，
 * 由 WS 层先用 `packBitsToWords` 打包好再进来。反之要向设备写出时，
 * 由服务端用 `expandPackedBitWords` 展开。打包/解包各只有一处。
 *
 * 数据格式的差异（字区 vs 位区）在这里**只表现为一行注释**，代码路径完全相同。
 */
export function applyRegistersToImage(
  image: ConnectionRegisterImage,
  area: RegisterArea,
  startRegister: number,
  values: number[],
  source: ValueSource,
  now: number,
): ApplyResult {
  const code = SOURCE_CODE[source];
  const grown = ensureImageCapacity(image, area, startRegister + values.length);

  const words = image.areas[area];
  const sources = image.sources[area];
  const updatedAt = image.updatedAt[area];

  let written = 0;
  for (let i = 0; i < values.length; i++) {
    const regIndex = startRegister + i;
    if (regIndex < 0 || regIndex >= words.length) break;
    words[regIndex] = values[i] & 0xffff;
    sources[regIndex] = code;
    updatedAt[regIndex] = now;
    written++;
  }
  return { grown, written };
}

/**
 * 位区专用的**位级增量写入**：改某几个位地址，不动同一寄存器里的其他位。
 *
 * ⚠️ 位序：字内 bit 0（LSB）= 编号最小的位地址。
 * 用于"用户逐个点 LED"这种场景 —— 但注意 master 的编辑路径是**整字草稿**，
 * 本函数主要供以后（R2 生成器 / 位级操作）使用。
 */
export function applyBitToImage(
  image: ConnectionRegisterImage,
  area: RegisterArea,
  bitAddress: number,
  value: boolean,
  source: ValueSource,
  now: number,
): ApplyResult {
  const regIndex = bitAddress >> 4;
  const grown = ensureImageCapacity(image, area, regIndex + 1);
  const words = image.areas[area];
  if (regIndex >= words.length) return { grown, written: 0 };
  words[regIndex] = withBitSet(words[regIndex] ?? 0, bitAddress & (BITS_PER_REGISTER - 1), value);
  image.sources[area][regIndex] = SOURCE_CODE[source];
  image.updatedAt[area][regIndex] = now;
  return { grown, written: 1 };
}

/**
 * 从镜像读出「寄存器单位」的一段行，供表格/格式化使用。
 *
 * 返回 `RegisterData[]`（长度 = `registerCount`），位区每行的 `rawValue`
 * 是**打包好的 16 位字** ⇒ 表格里一行 = 一个寄存器 = 16 个位地址（Q20 四区同构）。
 *
 * 超出已分配容量的部分返回 0（而不是报错）—— "设备就声明了这么大" 是正常情况，
 * 该不该提示越界由 UI 依据声明的 `areaTotalRegisters` 决定，不由镜像决定。
 */
export function readRegisterRows(
  image: ConnectionRegisterImage | undefined,
  area: RegisterArea,
  startRegister: number,
  registerCount: number,
): RegisterData[] {
  const rows: RegisterData[] = [];
  const words = image?.areas[area];
  const sources = image?.sources[area];

  for (let i = 0; i < registerCount; i++) {
    const regIndex = startRegister + i;
    const raw = words && regIndex >= 0 && regIndex < words.length ? words[regIndex] : 0;
    const code = sources && regIndex >= 0 && regIndex < sources.length ? sources[regIndex] : 0;
    rows.push({
      address: regIndex,
      rawValue: raw ?? 0,
      source: decodeSource(code),
    });
  }
  return rows;
}

/** 逐寄存器取某个地址的值（无则 0） */
export function readImageRegister(
  image: ConnectionRegisterImage | undefined,
  area: RegisterArea,
  registerIndex: number,
): number {
  const words = image?.areas[area];
  if (!words || registerIndex < 0 || registerIndex >= words.length) return 0;
  return words[registerIndex] ?? 0;
}
