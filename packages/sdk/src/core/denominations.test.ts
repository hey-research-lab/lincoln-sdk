import { describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
// Loaded before the network is selected, as the package entry (lincoln.ts) loads it.
import { presetsFor, minChangeFor } from './denominations.js';
const { POOLS, selectNetwork } = await import('./pools.js');

describe('denominations follow the network selected at runtime', () => {
  it('uses the mainnet ETH ladder once mainnet is selected', () => {
    selectNetwork('mainnet', { rpc: 'http://127.0.0.1:9' });
    expect(presetsFor(POOLS.eth)[0]).toBe(parseUnits('0.01', 18));
    expect(minChangeFor(POOLS.eth)).toBe(parseUnits('0.001', 18));
  });
  it('uses the testnet ETH ladder on the testnet', () => {
    selectNetwork('testnet', { rpc: 'http://127.0.0.1:9' });
    expect(presetsFor(POOLS.eth)[0]).toBe(parseUnits('0.0001', 18));
  });
});
