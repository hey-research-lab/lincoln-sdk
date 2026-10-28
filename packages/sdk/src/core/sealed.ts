// Local files the agent wallet keeps next to its key. Quotes, activity and pending points receipts name amounts,
// recipients and job IDs, so they are encrypted with the wallet's cache key (AES-GCM), like the notes cache.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { fromHex, toHex } from './sdk.js';
import { writePrivate } from './keystore.js';

export const readJson = async <T,>(file: string, fallback: T): Promise<T> => { const t = await readFile(file, 'utf8').catch(() => null); return t ? JSON.parse(t) as T : fallback; };
export async function readSealed<T>(file: string, key: Uint8Array, fallback: T): Promise<T> {
  const box = await readJson<{ iv?: string; data?: string } | T>(file, fallback);
  if (!box || typeof box !== 'object' || !('iv' in box) || !('data' in box)) return (box as T) ?? fallback; // legacy plain file
  try { return JSON.parse(new TextDecoder().decode(gcm(key, fromHex(box.iv!)).decrypt(fromHex(box.data!)))) as T; } catch { return fallback; }
}
export async function writeSealed(file: string, key: Uint8Array, value: unknown) {
  const iv = randomBytes(12);
  await writePrivate(file, JSON.stringify({ iv: toHex(iv), data: toHex(gcm(key, iv).encrypt(new TextEncoder().encode(JSON.stringify(value)))) }));
}
