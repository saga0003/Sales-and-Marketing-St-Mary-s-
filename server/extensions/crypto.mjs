import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const opaqueId = (prefix) => `${prefix}_${randomBytes(18).toString('base64url')}`;
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const secretEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

// AAD binds each encrypted value to its table record and purpose. Copying a
// ciphertext to another connection or replacing a provider secret fails closed.
export function createVault(value) {
  let key;
  if (Buffer.isBuffer(value)) key = value;
  else if (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value))
    key = Buffer.from(value, 'hex');
  else if (typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value))
    key = Buffer.from(value, 'base64');
  if (!key || key.length !== 32) {
    if (value)
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64 or hex.',
      );
    return null;
  }
  return {
    seal(data, purpose) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(data), 'utf8'),
        cipher.final(),
      ]);
      return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.');
    },
    open(value, purpose) {
      const [version, iv, tag, encrypted, extra] = String(value).split('.');
      if (version !== 'v1' || !iv || !tag || !encrypted || extra)
        throw new Error('Encrypted credentials are invalid.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted, 'base64url')),
          decipher.final(),
        ]).toString('utf8'),
      );
    },
  };
}
