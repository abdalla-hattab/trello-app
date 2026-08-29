import { createHash, randomUUID } from 'node:crypto';

export const newId = () => randomUUID();

export function stableHash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
