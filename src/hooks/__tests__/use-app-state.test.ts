import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appReducer,
  migrateConnection,
  migrateTab,
  type AppState,
} from '@/hooks/use-app-state';
import type { ConnectionConfig, RegisterTab } from '@/lib/modbus-types';

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

function makeTab(overrides: Partial<RegisterTab> = {}): RegisterTab {
  return {
    id: 'tab-1',
    name: 'Tab 1',
    connectionId: 'conn-1',
    startAddress: 0,
    registerCount: 8,
    functionCode: '03',
    pollInterval: 1000,
    displayFormat: 'hex',
    byteOrder32: 'ABCD',
    byteOrder64: 'ABCDEFGH',
    isPolling: false,
    ...overrides,
  };
}

function emptyState(): AppState {
  return {
    connections: [],
    connectionStatus: {},
    tabs: [],
    activeTabId: null,
    activeConnectionId: null,
    registerImages: {},
    logs: [],
  };
}

/** 建一个"已有一台连接"的状态 */
function stateWithConnection(conn: ConnectionConfig = makeConn()): AppState {
  return appReducer(emptyState(), { type: 'ADD_CONNECTION', payload: conn });
}

// ── 镜像生命周期 ─────────────────────────────────────────────────

describe('R3：连接设备镜像的生命周期', () => {
  it('新增连接时立即分配镜像，容量按各区声明', () => {
    const state = stateWithConnection(makeConn({
      coilCount: 4,
      discreteInputCount: 5,
      holdingRegisterCount: 6,
      inputRegisterCount: 7,
    }));
    const image = state.registerImages['conn-1'];
    assert.ok(image, '新增连接应带一份设备镜像');
    assert.equal(image.areas.coils.length, 4);
    assert.equal(image.areas.discreteInputs.length, 5);
    assert.equal(image.areas.holdingRegisters.length, 6);
    assert.equal(image.areas.inputRegisters.length, 7);
  });

  it('旧配置缺 4 个区域总量字段时补默认 1000', () => {
    // 模拟从旧版 localStorage 读出来的配置
    const legacy = makeConn();
    delete (legacy as Partial<ConnectionConfig>).coilCount;
    delete (legacy as Partial<ConnectionConfig>).holdingRegisterCount;

    const migrated = migrateConnection(legacy);
    assert.equal(migrated.coilCount, 1000);
    assert.equal(migrated.holdingRegisterCount, 1000);

    const state = stateWithConnection(legacy);
    assert.equal(state.registerImages['conn-1'].areas.coils.length, 1000);
  });

  it('读回的数据按**连接**写入镜像，而不是按标签', () => {
    let state = stateWithConnection();
    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters',
        startRegister: 2,
        values: [111, 222],
        source: 'master',
        now: 1000,
      },
    });
    const image = state.registerImages['conn-1'];
    assert.equal(image.areas.holdingRegisters[2], 111);
    assert.equal(image.areas.holdingRegisters[3], 222);
    assert.equal(image.version, 1, '版本号应+1，供 React 感知变更');
  });

  it('响应超出声明容量时自动扩容，并记一条日志', () => {
    let state = stateWithConnection(makeConn({ holdingRegisterCount: 8 }));
    assert.equal(state.logs.length, 0);

    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters',
        startRegister: 100,
        values: [7],
        source: 'master',
        now: 2000,
      },
    });

    const image = state.registerImages['conn-1'];
    assert.ok(image.areas.holdingRegisters.length > 100);
    assert.equal(image.areas.holdingRegisters[100], 7);
    assert.equal(state.logs.length, 1, '扩容应留下一条日志');
    assert.match(state.logs[0].message, /auto-grown/i);
    assert.equal(state.logs[0].connectionId, 'conn-1');
  });

  it('不扩容时不留日志（避免日志被正常读刷屏）', () => {
    let state = stateWithConnection(makeConn({ holdingRegisterCount: 100 }));
    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters',
        startRegister: 0,
        values: [1, 2, 3],
        source: 'master',
        now: 3000,
      },
    });
    assert.equal(state.logs.length, 0);
  });

  it('改 slaveId ⇒ 清空该连接的镜像（等于换了一台设备）', () => {
    let state = stateWithConnection();
    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters',
        startRegister: 0,
        values: [999],
        source: 'master',
        now: 4000,
      },
    });
    assert.equal(state.registerImages['conn-1'].areas.holdingRegisters[0], 999);

    state = appReducer(state, {
      type: 'UPDATE_CONNECTION',
      payload: makeConn({ slaveId: 2 }),
    });

    assert.equal(
      state.registerImages['conn-1'].areas.holdingRegisters[0],
      0,
      '换了单元号就是另一台设备，旧镜像必须清空',
    );
    assert.equal(state.registerImages['conn-1'].version, 0, '是重建，不是增量');
  });

  it('不改 slaveId ⇒ 镜像内容保留（只改名字之类不该丢数据）', () => {
    let state = stateWithConnection();
    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters',
        startRegister: 0,
        values: [555],
        source: 'master',
        now: 5000,
      },
    });
    state = appReducer(state, {
      type: 'UPDATE_CONNECTION',
      payload: makeConn({ name: 'renamed' }),
    });
    assert.equal(state.registerImages['conn-1'].areas.holdingRegisters[0], 555);
  });

  it('改声明容量 ⇒ 按新容量重建镜像', () => {
    let state = stateWithConnection(makeConn({ holdingRegisterCount: 8 }));
    state = appReducer(state, {
      type: 'UPDATE_CONNECTION',
      payload: makeConn({ holdingRegisterCount: 32 }),
    });
    assert.equal(state.registerImages['conn-1'].areas.holdingRegisters.length, 32);
  });

  it('删除连接 ⇒ 释放镜像', () => {
    let state = stateWithConnection();
    assert.ok(state.registerImages['conn-1']);
    state = appReducer(state, { type: 'DELETE_CONNECTION', payload: 'conn-1' });
    assert.equal(state.registerImages['conn-1'], undefined);
  });

  it('删除标签 ⇒ 不删镜像（镜像的归属是连接，标签只是视图）', () => {
    let state = stateWithConnection();
    state = appReducer(state, { type: 'ADD_TAB', payload: makeTab({ id: 'tab-2' }) });
    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters',
        startRegister: 0,
        values: [42],
        source: 'master',
        now: 6000,
      },
    });

    state = appReducer(state, { type: 'DELETE_TAB', payload: 'tab-2' });
    assert.ok(state.registerImages['conn-1'], '关标签不该让另一个标签看不到值');
    assert.equal(state.registerImages['conn-1'].areas.holdingRegisters[0], 42);
  });

  it('HYDRATE（从 localStorage 恢复）后按各连接重建镜像', () => {
    const persisted: AppState = {
      ...emptyState(),
      connections: [makeConn({ id: 'conn-a', holdingRegisterCount: 16 })],
      tabs: [makeTab({ id: 'tab-a', connectionId: 'conn-a' })],
      activeConnectionId: 'conn-a',
      activeTabId: 'tab-a',
      registerImages: {}, // 运行时状态不持久化
    };
    const state = appReducer(emptyState(), { type: 'HYDRATE', payload: persisted });
    assert.ok(state.registerImages['conn-a'], '恢复配置后镜像要被重建');
    assert.equal(state.registerImages['conn-a'].areas.holdingRegisters.length, 16);
  });

  it('写入确认把值落到镜像，来源记为 manual', () => {
    let state = stateWithConnection();
    state = appReducer(state, {
      type: 'APPLY_WRITE_ACK',
      payload: {
        connectionId: 'conn-1',
        area: 'coils',
        startRegister: 1,
        values: [0x000f],
        now: 7000,
      },
    });
    const image = state.registerImages['conn-1'];
    assert.equal(image.areas.coils[1], 0x000f);
    assert.equal(image.sources.coils[1], 2, 'manual 的编码是 2');
  });

  it('镜像不存在时收到数据不会崩，state 原样返回', () => {
    const before = emptyState();
    const after = appReducer(before, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'ghost',
        area: 'coils',
        startRegister: 0,
        values: [1],
        source: 'master',
        now: 8000,
      },
    });
    assert.equal(after, before);
  });

  it('RESET_CONNECTION_IMAGE 能手动清空某个连接的镜像', () => {
    let state = stateWithConnection();
    state = appReducer(state, {
      type: 'APPLY_REGISTER_DATA',
      payload: {
        connectionId: 'conn-1',
        area: 'inputRegisters',
        startRegister: 0,
        values: [123],
        source: 'master',
        now: 9000,
      },
    });
    state = appReducer(state, { type: 'RESET_CONNECTION_IMAGE', payload: 'conn-1' });
    assert.equal(state.registerImages['conn-1'].areas.inputRegisters[0], 0);
  });

  it('reducer 保持纯函数：同一份输入连跑两次结果一致', () => {
    const state = stateWithConnection();
    const action = {
      type: 'APPLY_REGISTER_DATA' as const,
      payload: {
        connectionId: 'conn-1',
        area: 'holdingRegisters' as const,
        startRegister: 0,
        values: [1, 2, 3],
        source: 'master' as const,
        now: 10_000,
      },
    };
    const a = appReducer(state, action);
    const b = appReducer(state, action);

    assert.notEqual(a.registerImages['conn-1'], state.registerImages['conn-1']);
    assert.equal(a.registerImages['conn-1'] === state.registerImages['conn-1'], false);
    assert.deepEqual(
      Array.from(a.registerImages['conn-1'].areas.holdingRegisters),
      Array.from(b.registerImages['conn-1'].areas.holdingRegisters),
    );
    // 原 state 未被就地污染（StrictMode 会重复调用 reducer）
    assert.equal(state.registerImages['conn-1'].areas.holdingRegisters[0], 0);
  });
});

// ── 字段迁移 ─────────────────────────────────────────────────────

describe('字段迁移：不猜旧字段语义', () => {
  it('migrateTab：旧 quantity 字段不迁移，回落默认 10', () => {
    const legacy = { ...makeTab(), quantity: 99 } as Partial<RegisterTab>;
    delete (legacy as { registerCount?: number }).registerCount;
    const migrated = migrateTab(legacy as Partial<RegisterTab> & { bitCount?: number });
    assert.equal(migrated.registerCount, 10);
  });

  it('migrateTab：旧 bitCount 不迁移（语义可能是"位数"，差 16 倍）', () => {
    const legacy: Partial<RegisterTab> & { bitCount?: number } = { ...makeTab(), bitCount: 160 };
    delete (legacy as { registerCount?: number }).registerCount;
    const migrated = migrateTab(legacy);
    assert.equal(migrated.registerCount, 10, '宁可回默认值，也不要搬一个错值');
  });

  it('migrateTab：已有 registerCount 时原样保留', () => {
    assert.equal(migrateTab(makeTab({ registerCount: 33 })).registerCount, 33);
  });

  it('migrateTab：startAddress 缺省为 0', () => {
    const legacy: Partial<RegisterTab> = {};
    const migrated = migrateTab(legacy);
    assert.equal(migrated.startAddress, 0);
    assert.equal(migrated.registerCount, 10);
  });

  it('migrateTab：把旧持久化里的 led 改写为 bits（类型更名）', () => {
    // 旧版本把 16 位位视图类型名写作 'led'；更名后必须迁移，否则会带废止的联合成员进运行时
    const legacy = {
      ...makeTab(),
      displayFormat: 'led',
    } as unknown as Partial<RegisterTab> & { bitCount?: number };
    assert.equal(migrateTab(legacy).displayFormat, 'bits');
  });

  it('migrateTab：缺省 displayFormat 回落 hex', () => {
    const legacy: Partial<RegisterTab> = {};
    assert.equal(migrateTab(legacy).displayFormat, 'hex');
  });

  it('migrateConnection：补齐 4 个区域总量为默认 1000', () => {
    const legacy = makeConn();
    delete (legacy as Partial<ConnectionConfig>).coilCount;
    delete (legacy as Partial<ConnectionConfig>).discreteInputCount;
    delete (legacy as Partial<ConnectionConfig>).holdingRegisterCount;
    delete (legacy as Partial<ConnectionConfig>).inputRegisterCount;

    const migrated = migrateConnection(legacy);
    assert.equal(migrated.coilCount, 1000);
    assert.equal(migrated.discreteInputCount, 1000);
    assert.equal(migrated.holdingRegisterCount, 1000);
    assert.equal(migrated.inputRegisterCount, 1000);
  });

  it('migrateConnection：已声明的容量不被覆盖', () => {
    assert.equal(migrateConnection(makeConn({ coilCount: 64 })).coilCount, 64);
  });
});
