import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** Coût de `scrypt` : N, r, p (OWASP : N = 2^16, r = 8, p = 1 au moins). Stocké avec chaque empreinte. */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 65536, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** Bornes à la lecture : une empreinte altérée ne doit pas pouvoir réclamer une mémoire démesurée. */
const MAX_N = 2 ** 17;
const MAX_R = 16;
const MAX_P = 4;

export const MIN_PASSWORD_LENGTH = 12;
/** Borne haute : `scrypt` travaille sur la totalité du mot de passe. */
export const MAX_PASSWORD_LENGTH = 256;

/** Mot de passe acceptable : de 12 à 256 caractères. Renvoie la raison du refus, sinon `null`. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'invalid_password';
  if (password.length < MIN_PASSWORD_LENGTH) return 'password_too_short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'password_too_long';
  return null;
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // 128 * N * r est la mémoire nécessaire ; une marge pour le reste.
    maxmem: 128 * params.N * params.r + 1024 * 1024,
  };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Empreinte `scrypt$N$r$p$sel$clé` (base64), avec un sel aléatoire propre au compte. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, params);
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

function parseHash(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const [scheme, n, r, p, salt, key, ...rest] = stored.split('$');
  if (scheme !== 'scrypt' || rest.length > 0 || !salt || !key) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const valid =
    Number.isInteger(params.N) &&
    params.N >= 2 &&
    params.N <= MAX_N &&
    (params.N & (params.N - 1)) === 0 &&
    Number.isInteger(params.r) &&
    params.r >= 1 &&
    params.r <= MAX_R &&
    Number.isInteger(params.p) &&
    params.p >= 1 &&
    params.p <= MAX_P;
  if (!valid) return null;
  return { params, salt: Buffer.from(salt, 'base64'), key: Buffer.from(key, 'base64') };
}

/** Vérifie un mot de passe en temps constant ; une empreinte illisible ne correspond jamais. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed || parsed.key.length !== KEY_LENGTH) return false;
  const candidate = await derive(password, parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.key);
}
