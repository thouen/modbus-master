import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { ConnectionConfig } from '@/lib/modbus-types';
import { connectClient, disconnectAllClients, disconnectClient } from '@/lib/modbus-client';

// ── 测试夹 ───────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 起一个「哑从站」：只接受 TCP 连接，不回应任何 ModBus 帧。
 * `kill()` 模拟从站进程退出 —— 先掐断已建立的连接，再关监听端口（可重复调用）。
 */
async function startDummySlave(): Promise<{ port: number; kill: () => Promise<void> }> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((s) => sockets.push(s));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  let killed = false;
  return {
    port,
    kill: async () => {
      if (killed) return;
      killed = true;
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function makeConn(port: number): ConnectionConfig {
  return {
    id: 'conn-test',
    name: 'conn-test',
    protocol: 'tcp',
    mode: 'rtu',
    tcpConfig: { host: '127.0.0.1', port },
    slaveId: 1,
    coilCount: 8,
    discreteInputCount: 8,
    holdingRegisterCount: 8,
    inputRegisterCount: 8,
    byteOrder32: 'ABCD',
    byteOrder64: 'ABCDEFGH',
  };
}

/**
 * ⚠️ 这组测试**依赖 modbus-serial 的内部结构**（`client._port._client` 这层 `net.Socket`），
 * 因为它正是本版本库里唯一可靠的对端断开入口：
 * `ports/tcpport.js` 在 socket `error` 时先置 `openFlag = false`，随后的 socket `close`
 * 因 `if (self.openFlag)` 不成立而**不再 `emit('close')`** ⇒ `client.on('close')` 收不到。
 * 若将来升级该库导致字段变化，`attachLostHooks()` 会静默退化为"无监测"，下面的用例会**失败并暴露**。
 */
describe('连接生命周期：对端掉线检测', () => {
  it('对端断开时触发 onLost —— 状态不会永远停在 connected', async () => {
    const dummy = await startDummySlave();
    try {
      const lost: string[] = [];
      await connectClient('t-lost', makeConn(dummy.port), { onLost: (r) => lost.push(r) });
      assert.equal(lost.length, 0, '刚连上时不应报掉线');

      await dummy.kill();
      await sleep(300);
      // `error` 与 `close` 常结伴而来（error → close），必须只报一次
      assert.equal(lost.length, 1, `应当只报一次掉线，实际 ${lost.length} 次：${lost.join(' | ')}`);
    } finally {
      await disconnectClient('t-lost');
      await dummy.kill();
    }
  });

  it('主动断开**不**触发 onLost（否则每次正常断开都会被当成掉线）', async () => {
    const dummy = await startDummySlave();
    try {
      const lost: string[] = [];
      await connectClient('t-manual', makeConn(dummy.port), { onLost: (r) => lost.push(r) });
      await disconnectClient('t-manual');
      await sleep(200);
      assert.equal(lost.length, 0, `主动断开不该报掉线，实际：${lost.join(' | ')}`);
    } finally {
      await dummy.kill();
    }
  });

  it('重连时旧 socket 的关闭不算掉线（钩子随连接一起换）', async () => {
    const dummy = await startDummySlave();
    try {
      const lostOld: string[] = [];
      const lostNew: string[] = [];
      await connectClient('t-reconnect', makeConn(dummy.port), { onLost: (r) => lostOld.push(r) });
      // 同一个 id 再连一次：`connectClient` 内部会先关掉旧客户端
      await connectClient('t-reconnect', makeConn(dummy.port), { onLost: (r) => lostNew.push(r) });
      await sleep(200);
      assert.equal(lostOld.length, 0, `旧连接的钩子应已摘除，实际：${lostOld.join(' | ')}`);

      await dummy.kill();
      await sleep(300);
      assert.equal(lostNew.length, 1, `新连接应当报一次掉线，实际 ${lostNew.length} 次`);
    } finally {
      await disconnectClient('t-reconnect');
      await dummy.kill();
      await disconnectAllClients();
    }
  });

  /**
   * ⭐ 回归守卫（2026-09-20 修的真实故障）：
   * `client.close()` 返回的 Promise 依赖底层端口的 close 回调，而该回调在
   * `openFlag === false`（= 对端已经掉线）时**永远不会被调用** ⇒ 裸 `await client.close()`
   * 会永久挂起，`disconnect` 指令就卡死 ⇒ **从站不在线时点「断开」没反应、也重连不上**。
   */
  it('对端已掉线时 disconnect 仍必须返回（否则「断开」按钮没反应）', async () => {
    const dummy = await startDummySlave();
    try {
      await connectClient('t-dead', makeConn(dummy.port), { onLost: () => undefined });
      // 让对端先掉线：此时底层端口的 openFlag 已被置 false
      await dummy.kill();
      await sleep(200);

      const started = Date.now();
      let settled = 'pending';
      await Promise.race([
        disconnectClient('t-dead').then(
          () => { settled = 'resolved'; },
          () => { settled = 'rejected'; },
        ),
        sleep(3000).then(() => { settled = '超时未返回'; }),
      ]);
      const elapsed = Date.now() - started;
      assert.notEqual(settled, '超时未返回', '对端掉线后 disconnect 必须返回，不能永久挂起');
      assert.ok(elapsed < 2000, `disconnect 应在兜底超时内返回，实际耗时 ${elapsed}ms`);
    } finally {
      await dummy.kill();
      await disconnectAllClients();
    }
  });
});
