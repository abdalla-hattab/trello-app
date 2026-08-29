export const nowIso = () => new Date().toISOString();

export function backoffMs(attempt, { base = 2_000, cap = 60_000 } = {}) {
  const exponential = Math.min(cap, base * (2 ** Math.max(0, attempt - 1)));
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}

export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
