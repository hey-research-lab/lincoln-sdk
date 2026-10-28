import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POLICY, checkPolicy, readPolicy, writeDefaultPolicy } from './policy.js';

describe('spending policy', () => {
  const p = { ...DEFAULT_POLICY, perTransactionUsd: 250, dailyUsd: 1000, approvalAboveUsd: 100 };
  it('allows small spends without approval', () => expect(checkPolicy(p, { action: 'send', usd: 20, spentTodayUsd: 0 })).toEqual({ allowed: true, needsApproval: false }));
  it('asks for approval above the threshold or without a price', () => {
    expect(checkPolicy(p, { action: 'swap', usd: 150, spentTodayUsd: 0 }).needsApproval).toBe(true);
    expect(checkPolicy(p, { action: 'swap', usd: null, spentTodayUsd: 0 })).toEqual({ allowed: true, needsApproval: true });
  });
  it('refuses over the per-transaction and daily limits', () => {
    expect(checkPolicy(p, { action: 'withdraw', usd: 300, spentTodayUsd: 0 }).code).toBe('POLICY_LIMIT');
    expect(checkPolicy(p, { action: 'withdraw', usd: 200, spentTodayUsd: 900 }).code).toBe('POLICY_DAILY');
  });
  it('enforces actions and the recipient allowlist', () => {
    expect(checkPolicy({ ...p, allowedActions: ['send'] }, { action: 'swap', usd: 1, spentTodayUsd: 0 }).code).toBe('POLICY_ACTION');
    const list = { ...p, allowedRecipients: ['0xAbC0000000000000000000000000000000000001'] };
    expect(checkPolicy(list, { action: 'withdraw', usd: 1, recipient: '0xabc0000000000000000000000000000000000001', spentTodayUsd: 0 }).allowed).toBe(true);
    expect(checkPolicy(list, { action: 'withdraw', usd: 1, recipient: '0x0000000000000000000000000000000000000002', spentTodayUsd: 0 }).code).toBe('POLICY_RECIPIENT');
  });
});

describe('season points opt-in', () => {
  const dir = () => mkdtemp(join(tmpdir(), 'lincoln-policy-'));
  it('is off by default, and lincoln init writes it as false', async () => {
    expect(DEFAULT_POLICY.seasonPoints).toBe(false);
    const file = join(await dir(), 'policy.json');
    await writeDefaultPolicy(file);
    expect(JSON.parse(await readFile(file, 'utf8')).seasonPoints).toBe(false);
    expect((await readPolicy(file)).seasonPoints).toBe(false);
    expect((await readPolicy(join(await dir(), 'missing.json'))).seasonPoints).toBe(false);
  });
  it('a policy file written before season points keeps working, as off', async () => {
    const file = join(await dir(), 'policy.json'), { seasonPoints: _, ...old } = DEFAULT_POLICY;
    await writeFile(file, JSON.stringify(old));
    expect((await readPolicy(file)).seasonPoints).toBe(false);
  });
  it('only a boolean turns it on', async () => {
    const file = join(await dir(), 'policy.json');
    await writeFile(file, JSON.stringify({ ...DEFAULT_POLICY, seasonPoints: true }));
    expect((await readPolicy(file)).seasonPoints).toBe(true);
    for (const bad of ['true', 1, null]) {
      await writeFile(file, JSON.stringify({ ...DEFAULT_POLICY, seasonPoints: bad }));
      await expect(readPolicy(file)).rejects.toThrow(/seasonPoints/);
    }
  });
});
