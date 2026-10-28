import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The wallet object's season points wiring, with no key on disk: the keystore is stubbed to a fixed seed, and the
// relay and points service are stubbed.
const SEED = 'ab'.repeat(32), ID = '0x9cd8317802a1cb9ea0d57d51ddec2bf352c1d6a6';
const relay = vi.hoisted(() => ({ config: { pointsReceipts: { season: 'season-1' } } as any, job: { status: 'confirmed', pointsStatus: 'pending' } as any }));
vi.mock('./core/keystore.js', async orig => ({
  ...(await orig<typeof import('./core/keystore.js')>()),
  readKeyFile: async () => ({ schema: 'lincoln-agent-key/v1', chainId: 4663, address: '0x00000000000000000000000000000000000000a1', createdAt: '', key: { plain: '0x' }, signIn: 2 }),
  unlockKey: async () => ({ address: '0x00000000000000000000000000000000000000a1' }),
  walletKeys: async () => ({ seed: 'ab'.repeat(32), cacheKey: new Uint8Array(32).fill(3) }),
}));
vi.mock('./core/relay.js', async orig => ({ ...(await orig<typeof import('./core/relay.js')>()), relayConfig: async () => relay.config, getJob: async () => relay.job }));

const { Lincoln, paths } = await import('./lincoln.js');
const { DEFAULT_POLICY } = await import('./core/policy.js');

async function wallet(seasonPoints: boolean | undefined) {
  const home = await mkdtemp(join(tmpdir(), 'lincoln-home-'));
  await mkdir(join(home, 'mainnet'), { recursive: true });
  const { seasonPoints: _, ...rest } = DEFAULT_POLICY;
  await writeFile(join(home, 'policy.json'), JSON.stringify(seasonPoints === undefined ? rest : { ...rest, seasonPoints }));
  return { home, lincoln: await Lincoln.open({ network: 'mainnet', home }) };
}
const posts: { url: string; body?: unknown }[] = [], reads: string[] = [];
function service({ receipt = 200 }: { receipt?: number } = {}) {
  posts.length = 0; reads.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') reads.push(url);
    if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return Response.json(receipt === 200 ? { ok: true } : { error: 'FEE_EVENT_NOT_INDEXED' }, { status: receipt }); }
    if (url.includes('/points/0x')) return Response.json({ season: 'season-1', points: '12.500000', feeEvents: 3, blockNumber: '1' });
    if (url.includes('/allocation/')) return Response.json({ units: '1234500000000000000000', preview: true, budget: { units: '1', decimals: 18, symbol: 'LINCOLN' } });
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
}
afterEach(() => { vi.unstubAllGlobals(); relay.job = { status: 'confirmed', pointsStatus: 'pending' }; relay.config = { pointsReceipts: { season: 'season-1' } }; });

describe('Lincoln season points', () => {
  it('derives the same points ID as the web app from the wallet seed', async () => {
    const { lincoln } = await wallet(false);
    expect(lincoln.pointsId).toBe(ID);
  });
  it('claims only while the policy opts in; confirmed jobs are queued encrypted with mode 0600', async () => {
    const { lincoln, home } = await wallet(true);
    const on = (lincoln as any).pointsHooks(true), off = (lincoln as any).pointsHooks(false);
    expect(await on.claim('eth', 'transact')).toEqual({ claimant: ID });
    expect(await on.claim('eth', 'ragequit')).toBeNull();
    expect(await off.claim('eth', 'transact')).toBeNull();
    relay.config = { pointsReceipts: null };
    expect(await on.claim('eth', 'transact')).toBeNull();
    await Promise.all([on.confirmed('eth', 'job-1'), on.confirmed('usdg', 'job-2')]);
    const file = paths(home, 'mainnet').pointsPending;
    expect(file).toBe(join(home, 'mainnet', 'points-pending.json'));
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    service();
    expect(await lincoln.collectPoints()).toEqual({ credited: 0, settled: 0, pending: 2 });
    relay.job = { status: 'confirmed', pointsStatus: 'issued', pointsReceipt: { claimant: ID } };
    expect(await lincoln.collectPoints()).toEqual({ credited: 2, settled: 0, pending: 0 });
    expect(posts.map(p => p.url)).toEqual(['https://app.lincolnprotocol.com/points/receipts', 'https://app.lincolnprotocol.com/points/receipts']);
  });
  it('posts nothing while season points are off, and does not ask the points service about the ID', async () => {
    const { lincoln } = await wallet(undefined);
    await (lincoln as any).pointsHooks(true).confirmed('eth', 'job-9');
    relay.job = { status: 'confirmed', pointsStatus: 'issued', pointsReceipt: { claimant: ID } };
    service();
    expect(await lincoln.collectPoints()).toEqual({ credited: 0, settled: 0, pending: 1 });
    expect(posts).toHaveLength(0);
    const r = await lincoln.points();
    expect(r).toMatchObject({ season: 'season-1', pointsId: ID, seasonPoints: false, pending: 1, collected: null, points: null, projectedLincoln: null });
    expect(r.error).toMatch(/seasonPoints/);
    expect(reads.filter(u => u.includes(ID))).toHaveLength(0);
    expect(r.note).toMatch(/not tokens and not a promise of payout/);
  });
  it('a points service refusal keeps the receipt for later', async () => {
    const { lincoln } = await wallet(true);
    await (lincoln as any).pointsHooks(true).confirmed('eth', 'job-3');
    relay.job = { status: 'confirmed', pointsStatus: 'issued', pointsReceipt: { claimant: ID } };
    service({ receipt: 409 });
    const r = await lincoln.points();
    expect(r).toMatchObject({ seasonPoints: true, pending: 1, collected: { credited: 0, settled: 0, pending: 1 } });
  });
});
