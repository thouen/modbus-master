import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateId, registerWindowKey } from '@/lib/modbus-utils';
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

  // ⚠️ 这里原有「仅换字节序 → 键不变」的用例，已删除：字节序改归**连接**（`ConnectionConfig`）后
  // 标签上**根本没有**这个字段 ⇒ 该不变量已由**类型系统**保证，不再需要用例。
  // （窗口身份的四个要素由下一条用例逐一断言。）

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

// ⚠️ 这组用例锁住 2026-09-22 修的那个 bug：经 frp / 内网穿透用 `http://IP:端口` 打开页面时，
// 浏览器判定为**非安全上下文**，`crypto.randomUUID` 会整个消失（不是报错，是方法不存在）
// ⇒ 点「保存连接」没反应。别再把 generateId 改回裸调 `crypto.randomUUID()`。
describe('generateId（非安全上下文降级）', () => {
  const originCrypto = globalThis.crypto;

  function stubCrypto(stub: Crypto | undefined) {
    Object.defineProperty(globalThis, 'crypto', {
      value: stub,
      configurable: true,
      writable: true,
    });
  }

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('有 randomUUID 时正常走它（HTTPS / localhost）', () => {
    stubCrypto(originCrypto);
    assert.match(generateId(), UUID_V4);
  });

  it('没有 randomUUID 时降级到 getRandomValues，仍是合法 UUID v4', () => {
    stubCrypto({ getRandomValues: originCrypto.getRandomValues.bind(originCrypto) } as unknown as Crypto);
    try {
      assert.match(generateId(), UUID_V4);
    } finally {
      stubCrypto(originCrypto);
    }
  });

  it('连 crypto 都不存在时也不抛错（兜底分支）', () => {
    stubCrypto(undefined);
    try {
      const id = generateId();
      assert.ok(typeof id === 'string' && id.length > 0);
    } finally {
      stubCrypto(originCrypto);
    }
  });
});
