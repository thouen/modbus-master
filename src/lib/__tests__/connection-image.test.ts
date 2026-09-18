import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConnectionConfig } from '@/lib/modbus-types';
import {
  BITS_PER_REGISTER,
  areaTotalRegistersFor,
  expandPackedBitWords,
  fcToArea,
  packBitsToWords,
  registerSpanToAddressSpan,
} from '@/lib/modbus-types';
import {
  applyBitToImage,
  applyRegistersToImage,
  areaCapacity,
  createConnectionImage,
  ensureImageCapacity,
  readPackedBit,
  readRegisterRows,
} from '@/lib/connection-image';

// ── 测试数据 ─────────────────────────────────────────────────────

function makeConn(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'conn-1',
    protocol: 'tcp',
    mode: 'rtu',
    tcpConfig: { host: '127.0.0.1', port: 502 },
    slaveId: 1,
    coilCount: 8,
    discreteInputCount: 8,
    holdingRegisterCount: 8,
    inputRegisterCount: 8,
    byteOrder32: 'ABCD',
    byteOrder64: 'ABCDEFGH',
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;

// ── 数组归属 ─────────────────────────────────────────────────────

describe('设备镜像：四区是四条独立数组（R3）', () => {
  it('每个区的数组长度 = 该区声明的总寄存器数量', () => {
    const image = createConnectionImage('conn-1', makeConn({
      coilCount: 4,
      discreteInputCount: 5,
      holdingRegisterCount: 6,
      inputRegisterCount: 7,
    }));
    assert.equal(image.areas.coils.length, 4);
    assert.equal(image.areas.discreteInputs.length, 5);
    assert.equal(image.areas.holdingRegisters.length, 6);
    assert.equal(image.areas.inputRegisters.length, 7);
  });

  it('位区不按位展开成数组：coilCount 个字 = coilCount × 16 个位地址', () => {
    const image = createConnectionImage('conn-1', makeConn({ coilCount: 8 }));
    // 8 个字而不是 128 个元素 —— 打包把内存压到 1/16
    assert.equal(image.areas.coils.length, 8);
    assert.equal(areaCapacity(image, 'coils') * BITS_PER_REGISTER, 128);
  });

  it('写 coils 不会影响 holdingRegisters（不同区互不共享）', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyRegistersToImage(image, 'coils', 0, [0xffff], 'master', NOW);
    applyRegistersToImage(image, 'holdingRegisters', 0, [0x1234], 'master', NOW);

    assert.equal(image.areas.coils[0], 0xffff);
    assert.equal(image.areas.holdingRegisters[0], 0x1234);
    // coils 改了不会污染 discreteInputs / inputRegisters
    assert.equal(image.areas.discreteInputs[0], 0);
    assert.equal(image.areas.inputRegisters[0], 0);
  });

  it('同一个地址号在四个区里是四个不同的单元', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyRegistersToImage(image, 'coils', 3, [1], 'master', NOW);
    applyRegistersToImage(image, 'discreteInputs', 3, [2], 'master', NOW);
    applyRegistersToImage(image, 'holdingRegisters', 3, [3], 'master', NOW);
    applyRegistersToImage(image, 'inputRegisters', 3, [4], 'master', NOW);

    assert.equal(image.areas.coils[3], 1);
    assert.equal(image.areas.discreteInputs[3], 2);
    assert.equal(image.areas.holdingRegisters[3], 3);
    assert.equal(image.areas.inputRegisters[3], 4);
  });
});

// ── 位序 ─────────────────────────────────────────────────────────

describe('位区打包：字内 bit 0 = 编号最小的位地址', () => {
  it('位序列 → 打包字：第 1 个元素落在 bit 0', () => {
    // 位地址 0 为 1，其余为 0
    const bits = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    assert.deepEqual(packBitsToWords(bits), [0b0000_0000_0000_0001]);
  });

  it('位序列 → 打包字：第 16 个元素落在 bit 15', () => {
    const bits = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    assert.deepEqual(packBitsToWords(bits), [0x8000]);
  });

  it('32 个位 = 2 个字', () => {
    const bits = new Array(32).fill(0);
    bits[0] = 1;   // 第 1 个字 bit 0
    bits[17] = 1;  // 第 2 个字 bit 1
    assert.deepEqual(packBitsToWords(bits), [0x0001, 0x0002]);
  });

  it('打包 / 展开互为逆运算', () => {
    const bits = [1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1];
    const words = packBitsToWords(bits);
    assert.deepEqual(expandPackedBitWords(words, bits.length), bits);
  });

  it('readPackedBit 与打包结果一致', () => {
    const words = packBitsToWords([1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(readPackedBit(words, 0), true);
    assert.equal(readPackedBit(words, 1), false);
    assert.equal(readPackedBit(words, 2), true);
    assert.equal(readPackedBit(words, 3), false);
  });

  it('位区写入按寄存器字落位：写 0x0001 就是该寄存器的第 1 个位地址为 1', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyRegistersToImage(image, 'coils', 0, [0x0001], 'master', NOW);
    assert.equal(readPackedBit(image.areas.coils, 0), true);
    assert.equal(readPackedBit(image.areas.coils, 15), false);
  });

  it('applyBitToImage 支持位级增量（不改同字其他位）', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyBitToImage(image, 'coils', 3, true, 'manual', NOW);
    applyBitToImage(image, 'coils', 5, true, 'manual', NOW);
    assert.equal(image.areas.coils[0], 0b0010_1000);
    applyBitToImage(image, 'coils', 3, false, 'manual', NOW);
    assert.equal(image.areas.coils[0], 0b0010_0000);
  });
});

// ── 自动扩容（主站特有） ──────────────────────────────────────────

describe('主站镜像的自动扩容（主站数组是接收缓冲区，可以变长）', () => {
  it('响应落在声明范围内时不扩容', () => {
    const image = createConnectionImage('conn-1', makeConn({ holdingRegisterCount: 100 }));
    const { grown } = applyRegistersToImage(image, 'holdingRegisters', 0, [1, 2, 3], 'master', NOW);
    assert.equal(grown, false);
    assert.equal(image.areas.holdingRegisters.length, 100);
  });

  it('响应超出声明范围时自动扩容，且不丢数据', () => {
    const image = createConnectionImage('conn-1', makeConn({ holdingRegisterCount: 100 }));
    // 声明"设备只有 100 个寄存器"，但读到了地址 500
    const { grown, written } = applyRegistersToImage(image, 'holdingRegisters', 500, [0xbeef], 'master', NOW);
    assert.equal(grown, true);
    assert.equal(written, 1);
    assert.ok(image.areas.holdingRegisters.length >= 501, '容量应至少覆盖到地址 500');
    assert.equal(image.areas.holdingRegisters[500], 0xbeef);
    // 原有数据不因扩容丢失
    assert.equal(image.areas.holdingRegisters[99], 0);
  });

  it('扩容是倍增的，避免逐次读越远时反复拷贝', () => {
    const image = createConnectionImage('conn-1', makeConn({ holdingRegisterCount: 100 }));
    applyRegistersToImage(image, 'holdingRegisters', 101, [1], 'master', NOW);
    // max(102, 100*2) = 200
    assert.equal(image.areas.holdingRegisters.length, 200);
  });

  it('扩容不会越过 65536 地址空间', () => {
    const image = createConnectionImage('conn-1', makeConn({ holdingRegisterCount: 100 }));
    ensureImageCapacity(image, 'holdingRegisters', 70_000);
    assert.equal(image.areas.holdingRegisters.length, 65_536);
  });

  it('位区扩容同样生效（按字数）', () => {
    const image = createConnectionImage('conn-1', makeConn({ coilCount: 8 }));
    // 写入落在**寄存器** 40 上（= 位地址 640 起的 16 个位）
    const { grown } = applyRegistersToImage(image, 'coils', 40, [0xffff], 'master', NOW);
    assert.equal(grown, true);
    assert.ok(image.areas.coils.length >= 41);
    assert.equal(image.areas.coils[40], 0xffff);
    // ⚠️ readPackedBit 收的是**位地址**，不是寄存器序号 —— 差 16 倍
    assert.equal(readPackedBit(image.areas.coils, 40 * BITS_PER_REGISTER), true);
    assert.equal(readPackedBit(image.areas.coils, 40 * BITS_PER_REGISTER + 15), true);
    assert.equal(readPackedBit(image.areas.coils, 40 * BITS_PER_REGISTER + 16), false);
  });

  it('扩容时 sources / updatedAt 同步变长，且保留既有值', () => {
    const image = createConnectionImage('conn-1', makeConn({ holdingRegisterCount: 8 }));
    applyRegistersToImage(image, 'holdingRegisters', 3, [42], 'manual', NOW);
    ensureImageCapacity(image, 'holdingRegisters', 100);
    assert.equal(image.sources.holdingRegisters.length, 100);
    assert.equal(image.updatedAt.holdingRegisters.length, 100);
    assert.equal(image.updatedAt.holdingRegisters[3], NOW);
  });
});

// ── 读取（四区同构） ─────────────────────────────────────────────

describe('readRegisterRows：一行 = 一个寄存器（四区同构）', () => {
  it('返回指定数量的行，address 是寄存器序号', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyRegistersToImage(image, 'holdingRegisters', 5, [11, 22], 'master', NOW);
    const rows = readRegisterRows(image, 'holdingRegisters', 5, 3);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.address), [5, 6, 7]);
    assert.deepEqual(rows.map(r => r.rawValue), [11, 22, 0]);
  });

  it('位区一行返回的是打包好的 16 位字', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyRegistersToImage(image, 'coils', 1, [0x00ff], 'master', NOW);
    const rows = readRegisterRows(image, 'coils', 1, 2);
    assert.equal(rows[0].rawValue, 0x00ff);
    assert.equal(rows[1].rawValue, 0);
  });

  it('超出已分配容量时返回 0，而不是抛错或产生空洞', () => {
    const image = createConnectionImage('conn-1', makeConn({ holdingRegisterCount: 2 }));
    const rows = readRegisterRows(image, 'holdingRegisters', 0, 5);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map(r => r.rawValue), [0, 0, 0, 0, 0]);
  });

  it('镜像不存在时也能安全读出全 0 行', () => {
    const rows = readRegisterRows(undefined, 'inputRegisters', 0, 3);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.rawValue), [0, 0, 0]);
  });

  it('行携带值来源，供界面按来源显示（Q7）', () => {
    const image = createConnectionImage('conn-1', makeConn());
    applyRegistersToImage(image, 'holdingRegisters', 0, [1], 'master', NOW);
    applyRegistersToImage(image, 'holdingRegisters', 1, [2], 'manual', NOW);
    const rows = readRegisterRows(image, 'holdingRegisters', 0, 3);
    assert.equal(rows[0].source, 'master');
    assert.equal(rows[1].source, 'manual');
    assert.equal(rows[2].source, null, '从未写入的格子不显示来源角标');
  });
});

// ── 单位换算 ─────────────────────────────────────────────────────

describe('寄存器单位 ↔ 地址单位（唯一一处 ×16）', () => {
  it('位区：寄存器 → 位地址要 ×16', () => {
    assert.deepEqual(registerSpanToAddressSpan('coils', 2, 3), { start: 32, count: 48 });
    assert.deepEqual(registerSpanToAddressSpan('discreteInputs', 0, 1), { start: 0, count: 16 });
  });

  it('字区：寄存器 = 地址，原样返回', () => {
    assert.deepEqual(registerSpanToAddressSpan('holdingRegisters', 2, 3), { start: 2, count: 3 });
    assert.deepEqual(registerSpanToAddressSpan('inputRegisters', 7, 1), { start: 7, count: 1 });
  });
});

describe('fcToArea：功能码 → 寄存器区域', () => {
  it('8 个支持的功能码全部映射正确', () => {
    // FC01/05/15 = 线圈
    assert.equal(fcToArea(1), 'coils');
    assert.equal(fcToArea(5), 'coils');
    assert.equal(fcToArea(15), 'coils');
    // FC02 = 离散输入
    assert.equal(fcToArea(2), 'discreteInputs');
    // FC03/06/16 = 保持寄存器
    assert.equal(fcToArea(3), 'holdingRegisters');
    assert.equal(fcToArea(6), 'holdingRegisters');
    assert.equal(fcToArea(16), 'holdingRegisters');
    // FC04 = 输入寄存器
    assert.equal(fcToArea(4), 'inputRegisters');
  });

  it('接受字符串功能码（UI 侧用 "01"~"16"）', () => {
    assert.equal(fcToArea('03'), 'holdingRegisters');
    assert.equal(fcToArea('16'), 'holdingRegisters');
    assert.equal(fcToArea('01'), 'coils');
  });

  it('不支持的功能码返回 null', () => {
    assert.equal(fcToArea(7), null);
    assert.equal(fcToArea(17), null);
  });
});

describe('areaTotalRegistersFor：归一化与下限', () => {
  it('下限为 1（零长数组会让越界语义失效）', () => {
    assert.equal(areaTotalRegistersFor(makeConn({ holdingRegisterCount: 0 }), 'holdingRegisters'), 1);
    assert.equal(areaTotalRegistersFor(makeConn({ holdingRegisterCount: -5 }), 'holdingRegisters'), 1);
    assert.equal(areaTotalRegistersFor(makeConn({ holdingRegisterCount: NaN }), 'holdingRegisters'), 1);
  });

  it('小数向下取整', () => {
    assert.equal(areaTotalRegistersFor(makeConn({ holdingRegisterCount: 10.9 }), 'holdingRegisters'), 10);
  });
});
