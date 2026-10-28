// LINCOLN season points (https://docs.lincolnprotocol.com/token/points), mirroring the web app (privacy-frontend
// src/wallet/season.ts). A relay job that carries `points: {claimant}` gets an EIP-712 receipt from the relay that
// processed it; the points service credits the claimant once the treasury Safe received the fee. The claimant is a
// points ID derived from the private wallet's seed, not the agent's public wallet: the service publishes each
// claimant's points, and a receipt ties its job to the claimant, so every job that names the same points ID becomes
// linkable to the others (never to a public wallet). Off unless the user sets `seasonPoints: true` in policy.json.
// Points are not tokens and not a promise of payout.
import { concat, keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import type { JobKind } from './relay.js';

export const SEASON_ID = 'season-1';
export const SEASON_END_BLOCK = 147_796_679n;
/** About when the end block lands (9.7 blocks/s); the block, not the date, is binding. */
export const SEASON_ENDS = '2026-12-24';
export const POINTS_RULES = 'https://docs.lincolnprotocol.com/token/points';
/** The points service, under the Lincoln app origin (`<app>/points`). */
export const pointsApi = (app: string) => `${app.replace(/\/+$/, '')}/points`;
/** Receipts are collected for a week; a job the relay never signed for by then has nothing to collect. */
export const RECEIPT_TTL_MS = 7 * 24 * 3600_000;
const REQUEST_TIMEOUT_MS = 20_000;

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/** The points ID's key, derived from the wallet seed under its own tag (byte-identical to the web app, so the same
 *  wallet opened in the app has the same points ID). It signs the season-end payout registration; it never holds funds. */
export function pointsKey(seed: string): Hex {
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error('Invalid wallet seed.');
  for (let counter = 0; counter < 256; counter++) {
    const key = keccak256(concat([toHex('lincoln/points-id/v1'), `0x${seed}`, toHex(counter, { size: 1 })]));
    if (BigInt(key) > 0n && BigInt(key) < N) return key;
  }
  throw new Error('Could not derive a points ID.');
}
export const pointsId = (seed: string) => privateKeyToAddress(pointsKey(seed)).toLowerCase() as Hex;

/** Whether a relay job names the points ID: only when the user opted in, never for a ragequit (no fee, and it returns
 *  funds to the public depositor), and only on a relay that signs receipts for this season (its /v3/config). */
export async function seasonClaim({ optIn, kind, seed, config }: {
  optIn: boolean; kind: JobKind; seed: string; config: () => Promise<{ pointsReceipts?: { season?: string } | null } | null | undefined>;
}): Promise<{ claimant: string } | null> {
  if (!optIn || kind === 'ragequit') return null;
  const c = await config();
  return c?.pointsReceipts?.season === SEASON_ID ? { claimant: pointsId(seed) } : null;
}

export interface PendingReceipt { pool: string; jobId: string; at: number }
export interface AccountPoints { points: string; feePoints: string; depositPoints: string; referralPoints: string; feeEvents: number; blockNumber: string }
export interface Allocation { units: string; preview: boolean; budget: { units: string; decimals: number; symbol: string } }

async function read<T>(api: string, path: string, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${api}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await res.json().catch(() => null) as T & { error?: string } | null;
  if (!res.ok || !body || body.error) throw new Error(body?.error ?? `POINTS_HTTP_${res.status}`);
  return body;
}
export const accountPoints = (api: string, id: string, fetcher?: typeof fetch) => read<AccountPoints>(api, `/points/${id}`, fetcher);
export const allocation = (api: string, id: string, fetcher?: typeof fetch) => read<Allocation>(api, `/allocation/${id}`, fetcher);

/** What happened to one pending receipt: settled (credited, already known, or nothing to credit) or try again later. */
export type ReceiptOutcome = 'credited' | 'settled' | 'retry';
export interface JobPoints { status?: string; pointsStatus?: string; pointsReceipt?: unknown }
export interface CollectDeps { api: string; getJob(pool: string, id: string): Promise<JobPoints>; now(): number; fetcher?: typeof fetch; timeoutMs?: number }

/** `p`, or a TIMEOUT error after `ms`. */
export const within = <T,>(p: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

/** One pass over a pending receipt: read the job, and post its receipt once the relay has signed it. */
export async function collectReceipt(entry: PendingReceipt, deps: CollectDeps): Promise<ReceiptOutcome> {
  if (deps.now() - entry.at > RECEIPT_TTL_MS) return 'settled';
  const timeoutMs = Math.max(1, Math.min(deps.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS));
  let job: JobPoints;
  try { job = await within(deps.getJob(entry.pool, entry.jobId), timeoutMs); } catch { return 'retry'; }
  if (job.status === 'cancelled' || job.status === 'reverted') return 'settled';
  // no-fee: nothing reached the treasury Safe, so there is nothing to credit; conflict: another receipt holds the fee.
  if (job.pointsStatus === 'no-fee' || job.pointsStatus === 'conflict' || job.pointsReceipt === null) return 'settled';
  if (!job.pointsReceipt) return 'retry';
  let res: Response;
  try {
    res = await (deps.fetcher ?? fetch)(`${deps.api}/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(job.pointsReceipt), signal: AbortSignal.timeout(timeoutMs) });
  } catch { return 'retry'; }
  if (res.ok) return 'credited';
  const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
  // The fee is newer than the service's confirmed checkpoint, or the service is busy or restarting: later.
  if (code === 'FEE_EVENT_NOT_INDEXED' || res.status === 429 || res.status >= 500) return 'retry';
  // RECEIPT_CONFLICT (already submitted) and any other refusal are final for this receipt.
  return 'settled';
}

/** Where pending receipts live between processes (the SDK keeps them encrypted in <home>/<network>/points-pending.json). */
export interface PendingStore { read(): Promise<PendingReceipt[]>; write(list: PendingReceipt[]): Promise<void> }
export interface CollectSummary { credited: number; settled: number; pending: number }

/** Collects pending receipts until none is left or `budgetMs` runs out, passing over them again every `retryEveryMs`
 *  (0: one pass). Entries still waiting are kept for a later call; nothing here throws over a single receipt.
 *  `update` serialises writes with other users of the same store (a spend adding an entry meanwhile is kept). */
export async function collectPending(store: PendingStore, deps: Omit<CollectDeps, 'timeoutMs'>, { budgetMs = 20_000, retryEveryMs = 0, update }: {
  budgetMs?: number; retryEveryMs?: number; update?: (f: (list: PendingReceipt[]) => PendingReceipt[]) => Promise<PendingReceipt[]>;
} = {}): Promise<CollectSummary> {
  const deadline = deps.now() + budgetMs;
  const apply = update ?? (async f => { const next = f(await store.read()); await store.write(next); return next; });
  let credited = 0, settled = 0, left = (await store.read()).length;
  for (;;) {
    const list = await store.read(), done = new Set<string>();
    for (const entry of list) {
      const remaining = deadline - deps.now();
      if (remaining <= 0) break;
      const outcome = await collectReceipt(entry, { ...deps, timeoutMs: remaining });
      if (outcome === 'credited') credited++;
      if (outcome === 'settled') settled++;
      if (outcome !== 'retry') done.add(entry.jobId);
    }
    left = done.size ? (await apply(l => l.filter(e => !done.has(e.jobId)))).length : (await store.read()).length;
    if (!left || !retryEveryMs || deps.now() + retryEveryMs >= deadline) return { credited, settled, pending: left };
    await new Promise(r => setTimeout(r, retryEveryMs));
  }
}
