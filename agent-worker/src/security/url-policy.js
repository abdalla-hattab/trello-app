import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from '../lib/errors.js';

function blockedV4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}

function blockedV6(address) {
  const value = address.toLowerCase().split('%')[0];
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) return blockedV4(value.slice(7));
  return value.startsWith('fc') || value.startsWith('fd') ||
    /^fe[89ab]/.test(value) || value.startsWith('ff') || value.startsWith('2001:db8:');
}

export function isBlockedAddress(address) {
  const kind = net.isIP(address);
  return kind === 4 ? blockedV4(address) : kind === 6 ? blockedV6(address) : true;
}

export async function assertPublicUrl(input, { lookup = dns.lookup } = {}) {
  let url;
  try { url = new URL(input); } catch { throw new AppError('The target URL is invalid.', { code: 'TARGET_INVALID', status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError('The target must be a public HTTP or HTTPS URL without embedded credentials.', { code: 'TARGET_REJECTED', status: 400 });
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new AppError('Private and local targets are not allowed.', { code: 'TARGET_REJECTED', status: 400 });
  }
  let addresses;
  if (net.isIP(hostname)) addresses = [{ address: hostname }];
  else {
    try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new AppError('The target hostname could not be resolved.', { code: 'TARGET_DNS_FAILED', retryable: true }); }
  }
  if (!addresses.length || addresses.some(record => isBlockedAddress(record.address))) {
    throw new AppError('The target resolves to a private, reserved, or unsafe network address.', { code: 'TARGET_REJECTED', status: 400 });
  }
  return url;
}
