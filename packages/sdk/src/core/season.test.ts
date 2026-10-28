import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECEIPT_TTL_MS, collectPending, collectReceipt, pointsApi, pointsId, pointsKey, seasonClaim, type PendingReceipt } from './season.js';
import { readSealed, writeSealed } from './sealed.js';

const SEED = 'ab'.repeat(32), API = pointsApi('https://app.lincolnprotocol.com');
const entry: PendingReceipt = { pool: 'eth', jobId: 'j1', at: 1_000 };
const receipt = { schema: 'lincoln-points-fee-receipt/v1', claimant: '0x' + '11'.repeat(20) };
const reply = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
const run = (job: object, fetcher = reply(200, { ok: true }), now = 2_000) =>
  collectReceipt(entry, { api: API, getJob: async () => job as never, now: () => now, fetcher });

describe('season points ID', () => {
  it('matches the web app byte for byte (vectors computed with privacy-frontend src/wallet/season.ts)', () => {
    expect(pointsKey(SEED)).toBe('0x6cf12b03e5bec6e6443dc353c37a545bd61477a0621c68e0ca8c02ad56a37c75');
    expect(pointsId(SEED)).toBe('0x9cd8317802a1cb9ea0d57d51ddec2bf352c1d6a6');
    expect(pointsId('00'.repeat(32))).toBe('0xb5a244bbcf85759a1f8ac3036667d7bc7e0b3c70');
    expect(pointsId('a1'.repeat(32))).toBe('0xf827a766914a12e6aa07efc0574455a729ca920d');
  });
  it('is a lowercase address, distinct per seed, and refuses a malformed seed', () => {
    expect(pointsId(SEED)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(pointsId('cd'.repeat(32))).not.toBe(pointsId(SEED));
    expect(() => pointsKey('xyz')).toThrow();
    expect(() => pointsKey('AB'.repeat(32))).toThrow();
  });
  it('points API lives under the app origin', () => expect(pointsApi('https://app.lincolnprotocol.com/')).toBe('https://app.lincolnprotocol.com/points'));
});

describe('which relay jobs name the points ID', () => {
  const season1 = async () => ({ pointsReceipts: { season: 'season-1' } });
  it('only when opted in, not for a ragequit, and only on a relay signing season-1 receipts', async () => {
    expect(await seasonClaim({ optIn: true, kind: 'transact', seed: SEED, config: season1 })).toEqual({ claimant: pointsId(SEED) });
    expect(await seasonClaim({ optIn: true, kind: 'swap', seed: SEED, config: season1 })).toEqual({ claimant: pointsId(SEED) });
    expect(await seasonClaim({ optIn: false, kind: 'transact', seed: SEED, config: season1 })).toBeNull();
    let asked = false;
    expect(await seasonClaim({ optIn: true, kind: 'ragequit', seed: SEED, config: async () => { asked = true; return season1(); } })).toBeNull();
    expect(asked).toBe(false);
    for (const c of [null, {}, { pointsReceipts: null }, { pointsReceipts: { season: 'season-2' } }])
      expect(await seasonClaim({ optIn: true, kind: 'transact', seed: SEED, config: async () => c })).toBeNull();
  });
});

describe('receipt collection', () => {
  it('posts a signed receipt to /points/receipts and reports it credited', async () => {
    let posted: unknown = null, url = '';
    const fetcher = (async (u: string, init: RequestInit) => { url = u; posted = JSON.parse(String(init.body)); return Response.json({ ok: true }); }) as unknown as typeof fetch;
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, fetcher)).toBe('credited');
    expect(url).toBe('https://app.lincolnprotocol.com/points/receipts');
    expect(posted).toEqual(receipt);
  });
  it('waits for the relay to sign, and for the service to index the fee', async () => {
    expect(await run({ status: 'confirmed', pointsStatus: 'pending' })).toBe('retry');
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, reply(409, { error: 'FEE_EVENT_NOT_INDEXED' }))).toBe('retry');
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, reply(429, { error: 'RATE_LIMITED' }))).toBe('retry');
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, reply(502, { error: 'POINTS_UNREACHABLE' }))).toBe('retry');
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe('retry');
    expect(await collectReceipt(entry, { api: API, getJob: async () => { throw new Error('offline'); }, now: () => 2_000 })).toBe('retry');
    // A relay that never answers counts as "later", within the time allowed.
    expect(await collectReceipt(entry, { api: API, getJob: () => new Promise(() => undefined), now: () => 2_000, timeoutMs: 20 })).toBe('retry');
  });
  it('settles receipts with nothing to credit, duplicates, refusals and old entries', async () => {
    expect(await run({ status: 'confirmed', pointsStatus: 'no-fee', pointsReceipt: null })).toBe('settled');
    expect(await run({ status: 'confirmed', pointsStatus: 'conflict' })).toBe('settled');
    expect(await run({ status: 'cancelled' })).toBe('settled');
    expect(await run({ status: 'reverted' })).toBe('settled');
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, reply(409, { error: 'RECEIPT_CONFLICT' }))).toBe('settled');
    expect(await run({ status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt }, reply(403, { error: 'RECEIPT_SIGNER_UNKNOWN' }))).toBe('settled');
    expect(await run({ status: 'confirmed', pointsStatus: 'pending' }, undefined, 1_000 + RECEIPT_TTL_MS + 1)).toBe('settled');
  });
});

describe('pending receipts', () => {
  const jobs: Record<string, object> = {
    a: { status: 'confirmed', pointsStatus: 'issued', pointsReceipt: receipt },
    b: { status: 'confirmed', pointsStatus: 'pending' },
    c: { status: 'confirmed', pointsStatus: 'no-fee', pointsReceipt: null },
  };
  const deps = (now = () => 2_000) => ({ api: API, getJob: async (_: string, id: string) => jobs[id] as never, now, fetcher: reply(200, { ok: true }) });

  it('persist encrypted with mode 0600 and keep only what still waits', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'lincoln-points-')), 'mainnet', 'points-pending.json'), key = new Uint8Array(32).fill(7);
    const store = { read: () => readSealed<PendingReceipt[]>(file, key, []), write: (l: PendingReceipt[]) => writeSealed(file, key, l) };
    await store.write(['a', 'b', 'c'].map(jobId => ({ pool: 'eth', jobId, at: 1_000 })));
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain('"jobId"');
    expect(await collectPending(store, deps())).toEqual({ credited: 1, settled: 1, pending: 1 });
    expect((await store.read()).map(e => e.jobId)).toEqual(['b']);
    // Still waiting a week later: dropped.
    expect(await collectPending(store, deps(() => 1_000 + RECEIPT_TTL_MS + 1))).toEqual({ credited: 0, settled: 1, pending: 0 });
    expect(await store.read()).toEqual([]);
  });
  it('keep an entry added while a pass runs, and stop when the time budget is spent', async () => {
    let list: PendingReceipt[] = [{ pool: 'eth', jobId: 'a', at: 1_000 }, { pool: 'eth', jobId: 'b', at: 1_000 }];
    const store = { read: async () => list, write: async (l: PendingReceipt[]) => { list = l; } };
    const slow = { ...deps(), getJob: async (_: string, id: string) => { if (id === 'a') list = [...list, { pool: 'eth', jobId: 'd', at: 1_500 }]; return jobs[id] as never; } };
    expect(await collectPending(store, slow)).toEqual({ credited: 1, settled: 0, pending: 2 });
    expect(list.map(e => e.jobId)).toEqual(['b', 'd']);
    let t = 0;
    const started = Date.now();
    const r = await collectPending(store, { ...deps(() => t), getJob: async (_: string, id: string) => { t += 1_000; return jobs[id] as never; } }, { budgetMs: 500, retryEveryMs: 5_000 });
    expect(r.pending).toBe(2);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
