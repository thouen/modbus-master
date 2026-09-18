import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerWindowKey } from '@/lib/modbus-utils';
import type { RegisterTab } from '@/lib/modbus-types';

function makeTab(overrides: Partial<RegisterTab> = {}): RegisterTab {
  return {
    id: 'tab-1',
    name: 'Tab 1',
    connectionId: 'conn-1',
    startAddress: 0,
    registerCount: 10,
    functionCode: '03',
    pollInterval: 1000,
    displayFormat: 'hex',
    byteOrder32: 'ABCD',
    byteOrder64: 'ABCDEFGH',
    isPolling: false,
    ...overrides,
  };
}

describe('registerWindowKey（窗口身份）', () => {
  it('同一个窗口的键是稳定的', () => {
    assert.equal(registerWindowKey(makeTab()), registerWindowKey(makeTab()));
  });

  it('换功能码 → 换键（FC03 读视图 ≠ FC06 写视图）', () => {
    assert.notEqual(
      registerWindowKey(makeTab({ functionCode: '03' })),
      registerWindowKey(makeTab({ functionCode: '06' })),
    );
  });

  it('换起始地址 → 换键', () => {
    assert.notEqual(
      registerWindowKey(makeTab({ startAddress: 0 })),
      registerWindowKey(makeTab({ startAddress: 10 })),
    );
  });

  it('换寄存器数量 → 换键（覆盖的范围变了）', () => {
    assert.notEqual(
      registerWindowKey(makeTab({ registerCount: 10 })),
      registerWindowKey(makeTab({ registerCount: 20 })),
    );
  });

  it('换标签 → 换键（草稿不跨标签串）', () => {
    assert.notEqual(
      registerWindowKey(makeTab({ id: 'tab-1' })),
      registerWindowKey(makeTab({ id: 'tab-2' })),
    );
  });

  it('换显示格式 → 键不变（格式不是窗口身份的一部分）', () => {
    assert.equal(
      registerWindowKey(makeTab({ displayFormat: 'hex' })),
      registerWindowKey(makeTab({ displayFormat: 'float' })),
    );
  });

  it('改标签名 → 键不变（改名不动数据）', () => {
    assert.equal(
      registerWindowKey(makeTab({ name: 'A' })),
      registerWindowKey(makeTab({ name: 'B' })),
    );
  });

  it('仅换字节序 → 键不变', () => {
    assert.equal(
      registerWindowKey(makeTab({ byteOrder32: 'ABCD' })),
      registerWindowKey(makeTab({ byteOrder32: 'DCBA' })),
    );
  });

  it('窗口键里包含 id / 功能码 / 起始地址 / 数量四个要素', () => {
    const key = registerWindowKey(makeTab({ id: 'x', functionCode: '04', startAddress: 7, registerCount: 3 }));
    assert.ok(key.includes('x'));
    assert.ok(key.includes('04'));
    assert.ok(key.includes('7'));
    assert.ok(key.includes('3'));
  });

  it('不同标签指向同一块寄存器时键不同（草稿按窗口隔离）', () => {
    const a = registerWindowKey(makeTab({ id: 'a', startAddress: 0, registerCount: 10 }));
    const b = registerWindowKey(makeTab({ id: 'b', startAddress: 0, registerCount: 10 }));
    assert.notEqual(a, b);
  });
});
