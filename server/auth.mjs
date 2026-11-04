import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const scryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keyLength = 64;
export const COOKIE_NAME = 'smis_session';

export function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, keyLength, scryptOptions).toString('hex');
  return `scrypt$16384$8$1$${salt}$${key}`;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, keyLength, scryptOptions);
  return `scrypt$16384$8$1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded).split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== '16384' ||
    parts[2] !== '8' ||
    parts[3] !== '1'
  )
    return false;
  if (!/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const actual = await scrypt(password, parts[4], keyLength, scryptOptions);
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function cookieToken(request) {
  const cookies = request.get('cookie');
  if (!cookies) return null;
  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const token = pair.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
  return null;
}

export function equalTokens(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieOptions(secure, maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', ...(maxAge ? { maxAge } : {}) };
}
