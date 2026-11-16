import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_SCRYPT_PARAMS,
  MAX_PASSWORD_LENGTH,
  hashPassword,
  passwordProblem,
  verifyPassword,
  type ScryptParams,
} from './password.js';
import {
  type Account,
  type AccountRecord,
  type Role,
  type SqliteAccountStore,
} from './sqlite/sqlite-account-store.js';

/** Expiration d'une session après cette durée sans requête. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** Échecs consécutifs tolérés avant la première temporisation. */
export const MAX_FAILURES = 5;
/** Première temporisation ; elle double à chaque échec suivant, jusqu'à `MAX_LOCK_MS`. */
export const BASE_LOCK_MS = 30_000;
export const MAX_LOCK_MS = 15 * 60_000;
/** Sans échec pendant cette durée, le compteur repart de zéro. */
const FAILURE_MEMORY_MS = 60 * 60_000;
/** Bornes de mémoire : un attaquant ne doit pas pouvoir remplir les tables par des noms inventés. */
const MAX_TRACKED = 10_000;
const MAX_SESSIONS = 10_000;

export interface Session {
  accountId: number;
  username: string;
  role: Role;
  mustChangePassword: boolean;
  oidc: boolean;
  csrfToken: string;
}

export type LoginResult =
  | { ok: true; account: AccountRecord }
  | {
      ok: false;
      reason: 'bad_credentials' | 'locked' | 'disabled';
      /** Compte existant dont le nom a été saisi (pour l'audit) ; jamais un nom inventé. */
      account?: AccountRecord;
      retryAfterSec?: number;
      /** Vrai pour la seule première réponse « verrouillé » d'une série : seule celle-ci est consignée. */
      firstLock?: boolean;
    };

interface Failures {
  count: number;
  lockedUntil: number;
  last: number;
  /** Le passage en verrou a déjà été consigné à l'audit. */
  reported?: boolean;
}

/** Temporisation croissante après `MAX_FAILURES` échecs, suivie par compte et par adresse IP. */
class LoginThrottle {
  private readonly entries = new Map<string, Failures>();

  constructor(private readonly now: () => number) {}

  /** Millisecondes restantes avant de pouvoir réessayer, 0 si libre. */
  remainingMs(keys: string[]): number {
    const now = this.now();
    return Math.max(0, ...keys.map((k) => (this.entries.get(k)?.lockedUntil ?? 0) - now));
  }

  fail(keys: string[]): void {
    const now = this.now();
    if (this.entries.size >= MAX_TRACKED) this.prune(now);
    for (const key of keys) {
      const known = this.entries.get(key);
      const count = (known && now - known.last < FAILURE_MEMORY_MS ? known.count : 0) + 1;
      const lockMs =
        count >= MAX_FAILURES
          ? Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (count - MAX_FAILURES))
          : 0;
      this.entries.set(key, { count, lockedUntil: now + lockMs, last: now });
    }
  }

  /**
   * Essais en cours de vérification : `scrypt` est asynchrone, donc des requêtes simultanées
   * passeraient toutes le contrôle avant que le premier échec soit compté. Un essai nouveau est
   * refusé si les échecs connus et les essais en vol atteignent déjà le seuil.
   */
  private readonly inflight = new Map<string, number>();

  busy(keys: string[]): boolean {
    const now = this.now();
    return keys.some((k) => {
      const known = this.entries.get(k);
      const count = known && now - known.last < FAILURE_MEMORY_MS ? known.count : 0;
      // Au-delà du seuil, `lockedUntil` décide ; ici un seul essai en vol est toléré à la fois.
      return Math.min(count, MAX_FAILURES - 1) + (this.inflight.get(k) ?? 0) >= MAX_FAILURES;
    });
  }

  begin(keys: string[]): void {
    for (const k of keys) this.inflight.set(k, (this.inflight.get(k) ?? 0) + 1);
  }

  end(keys: string[]): void {
    for (const k of keys) {
      const n = (this.inflight.get(k) ?? 1) - 1;
      if (n <= 0) this.inflight.delete(k);
      else this.inflight.set(k, n);
    }
  }

  /**
   * Vrai une seule fois par verrou : le journal d'audit est en ajout seul, les requêtes refusées
   * par le verrou ne doivent donc pas toutes y écrire une ligne.
   */
  claimLockReport(keys: string[]): boolean {
    const now = this.now();
    let first = false;
    for (const k of keys) {
      const entry = this.entries.get(k);
      if (entry && entry.lockedUntil > now && !entry.reported) {
        entry.reported = true;
        first = true;
      }
    }
    return first;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.last >= FAILURE_MEMORY_MS) this.entries.delete(key);
    }
    // Table encore pleine de noms récents : on repart de zéro plutôt que de grossir sans fin.
    if (this.entries.size >= MAX_TRACKED) this.entries.clear();
  }
}

export interface AuthOptions {
  store: SqliteAccountStore;
  now?: () => number;
  hashParams?: ScryptParams;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Compare deux jetons en temps constant. */
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Comptes locaux et sessions. Les sessions vivent en mémoire (clé : SHA-256 du jeton, le jeton
 * lui-même n'est jamais conservé) : un redémarrage déconnecte tout le monde. Rôle, activation et
 * obligation de changer le mot de passe sont relus dans la base à chaque requête : désactiver un
 * compte ou changer son rôle prend effet immédiatement.
 */
export class AuthService {
  private readonly store: SqliteAccountStore;
  private readonly now: () => number;
  private readonly hashParams: ScryptParams;
  private readonly throttle: LoginThrottle;
  private readonly sessions = new Map<
    string,
    { accountId: number; csrfToken: string; lastSeen: number }
  >();
  /** Empreinte factice calculée dès le départ : le 1er essai sur un nom inconnu n'est pas plus lent. */
  private readonly dummyHash: Promise<string>;

  constructor({ store, now = Date.now, hashParams = DEFAULT_SCRYPT_PARAMS }: AuthOptions) {
    this.store = store;
    this.now = now;
    this.hashParams = hashParams;
    this.throttle = new LoginThrottle(now);
    this.dummyHash = this.hash('dummy-password-for-timing');
    this.dummyHash.catch(() => undefined);
  }

  get accounts(): SqliteAccountStore {
    return this.store;
  }

  hash(password: string): Promise<string> {
    return hashPassword(password, this.hashParams);
  }

  needsSetup(): boolean {
    return this.store.count() === 0;
  }

  /** Crée l'administrateur initial ; `undefined` si un compte existe déjà. */
  async setup(username: string, password: string): Promise<AccountRecord | undefined> {
    return this.store.createFirstAdmin(username, await this.hash(password));
  }

  /** Vérifie les identifiants, sous temporisation par compte et par adresse IP. */
  async authenticate(username: string, password: string, ip: string): Promise<LoginResult> {
    const keys = [`u:${username.toLowerCase()}`, `i:${ip}`];
    const account = this.store.findByUsername(username);
    const waitMs = this.throttle.remainingMs(keys);
    if (waitMs > 0 || this.throttle.busy(keys)) {
      return {
        ok: false,
        reason: 'locked',
        ...(account ? { account } : {}),
        retryAfterSec: Math.ceil((waitMs > 0 ? waitMs : BASE_LOCK_MS) / 1000),
        // Un refus « occupé » (essais en vol) n'est jamais consigné.
        firstLock: waitMs > 0 && this.throttle.claimLockReport(keys),
      };
    }
    this.throttle.begin(keys);
    try {
      // Compte inconnu : même travail qu'un compte connu, pour ne pas révéler son existence.
      const stored = account?.passwordHash || (await this.dummyHash);
      const computed =
        password.length <= MAX_PASSWORD_LENGTH && (await verifyPassword(password, stored));
      // Compte Microsoft : l'empreinte factice (publique) sert au temps de calcul seulement ;
      // aucun mot de passe ne doit l'ouvrir.
      const matches = computed && !account?.oidc;
      if (!account || !matches) {
        this.throttle.fail(keys);
        return { ok: false, reason: 'bad_credentials', ...(account ? { account } : {}) };
      }
      if (account.disabled) {
        this.throttle.fail(keys);
        return { ok: false, reason: 'disabled', account };
      }
      this.throttle.reset(keys[0]!);
      return { ok: true, account };
    } finally {
      this.throttle.end(keys);
    }
  }

  /** Ouvre une session ; renvoie le jeton du cookie et le jeton CSRF. */
  startSession(account: Account): { token: string; csrfToken: string } {
    const now = this.now();
    if (this.sessions.size >= MAX_SESSIONS) this.sweep(now);
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    this.sessions.set(sha256(token), { accountId: account.id, csrfToken, lastSeen: now });
    return { token, csrfToken };
  }

  /** Session valide pour ce jeton, dont l'inactivité est remise à zéro ; sinon `undefined`. */
  getSession(token: string | undefined): Session | undefined {
    if (!token) return undefined;
    const key = sha256(token);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    const now = this.now();
    const account = this.store.findById(session.accountId);
    if (now - session.lastSeen >= SESSION_IDLE_MS || !account || account.disabled) {
      this.sessions.delete(key);
      return undefined;
    }
    session.lastSeen = now;
    return {
      accountId: account.id,
      username: account.username,
      role: account.role,
      mustChangePassword: account.mustChangePassword,
      oidc: account.oidc,
      csrfToken: session.csrfToken,
    };
  }

  endSession(token: string | undefined): void {
    if (token) this.sessions.delete(sha256(token));
  }

  /** Ferme les sessions d'un compte, sauf celle dont le jeton est donné. */
  revokeAccount(accountId: number, exceptToken?: string): void {
    const keep = exceptToken ? sha256(exceptToken) : undefined;
    for (const [key, session] of this.sessions) {
      if (session.accountId === accountId && key !== keep) this.sessions.delete(key);
    }
  }

  /**
   * Change son propre mot de passe : l'ancien est exigé et les autres sessions sont fermées. Les
   * échecs sont comptés dans la temporisation du compte, comme à la connexion.
   */
  async changePassword(
    accountId: number,
    token: string,
    current: string,
    next: string,
  ): Promise<{ outcome: string; retryAfterSec?: number; firstLock?: boolean }> {
    const account = this.store.findById(accountId);
    if (!account) return { outcome: 'wrong_password' };
    const keys = [`u:${account.username.toLowerCase()}`];
    const waitMs = this.throttle.remainingMs(keys);
    if (waitMs > 0 || this.throttle.busy(keys)) {
      return {
        outcome: 'locked',
        retryAfterSec: Math.ceil((waitMs > 0 ? waitMs : BASE_LOCK_MS) / 1000),
        firstLock: waitMs > 0 && this.throttle.claimLockReport(keys),
      };
    }
    this.throttle.begin(keys);
    try {
      if (
        current.length > MAX_PASSWORD_LENGTH ||
        !(await verifyPassword(current, account.passwordHash))
      ) {
        this.throttle.fail(keys);
        return { outcome: 'wrong_password' };
      }
    } finally {
      this.throttle.end(keys);
    }
    this.throttle.reset(keys[0]!);
    const problem = passwordProblem(next);
    if (problem) return { outcome: problem };
    if (next === current) return { outcome: 'same_password' };
    this.store.update(accountId, {
      passwordHash: await this.hash(next),
      mustChangePassword: false,
    });
    this.revokeAccount(accountId, token);
    return { outcome: 'ok' };
  }

  /** Réinitialisation par un administrateur : mot de passe provisoire, à changer à la connexion. */
  async resetPassword(accountId: number, password: string): Promise<AccountRecord | undefined> {
    const updated = this.store.update(accountId, {
      passwordHash: await this.hash(password),
      mustChangePassword: true,
    });
    if (updated) this.revokeAccount(accountId);
    return updated;
  }

  private sweep(now: number): void {
    for (const [key, session] of this.sessions) {
      if (now - session.lastSeen >= SESSION_IDLE_MS) this.sessions.delete(key);
    }
    // Table pleine de sessions actives : on refuse de grossir sans fin en retirant les plus anciennes.
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (const [key] of oldest.slice(0, Math.ceil(MAX_SESSIONS / 10))) this.sessions.delete(key);
    }
  }
}
