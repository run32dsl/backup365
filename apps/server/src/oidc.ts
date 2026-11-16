import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Role } from './sqlite/sqlite-account-store.js';

/** Chemin de retour de l'application dans Entra ID (ADR 0015). */
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

export interface OidcConfig {
  tenantId: string;
  clientId: string;
  /** Secret de l'application : jamais journalisé ni renvoyé. */
  clientSecret: string;
  redirectUri: string;
  /** Identifiants d'objet des groupes Entra qui donnent chaque rôle. */
  adminGroups: readonly string[];
  operatorGroups: readonly string[];
}

export interface OidcEndpoints {
  issuer: string;
  authorization: string;
  token: string;
  jwks: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Points d'accès d'Entra ID pour un tenant (v2.0). */
export function entraEndpoints(tenantId: string): OidcEndpoints {
  const base = `https://login.microsoftonline.com/${tenantId}`;
  return {
    issuer: `${base}/v2.0`,
    authorization: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
    jwks: `${base}/discovery/v2.0/keys`,
  };
}

function guidList(name: string, raw: string | undefined): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.every((g) => GUID.test(g))) {
    throw new Error(
      `${name} invalide : attendu des identifiants d'objet (GUID) séparés par des virgules`,
    );
  }
  return items.map((g) => g.toLowerCase());
}

/**
 * Configuration de la connexion Microsoft (`BACKUP365_OIDC_*`). `undefined` si aucune variable
 * n'est donnée (connexion désactivée) ; sinon le tenant, l'application, le secret, l'adresse de
 * retour et au moins une liste de groupes sont exigés. Les erreurs nomment les variables, jamais
 * leur valeur.
 */
export function parseOidcConfig(env: Record<string, string | undefined>): OidcConfig | undefined {
  const names = [
    'TENANT_ID',
    'CLIENT_ID',
    'CLIENT_SECRET',
    'REDIRECT_URI',
    'ADMIN_GROUPS',
    'OPERATOR_GROUPS',
  ].map((n) => `BACKUP365_OIDC_${n}`);
  if (names.every((n) => !env[n])) return undefined;
  const missing = names.slice(0, 4).filter((n) => !env[n]);
  if (missing.length > 0) {
    throw new Error(
      `Configuration de la connexion Microsoft incomplète : ${missing.join(', ')} manquant(s)`,
    );
  }
  const tenantId = env['BACKUP365_OIDC_TENANT_ID']!;
  if (!GUID.test(tenantId)) throw new Error('BACKUP365_OIDC_TENANT_ID invalide : attendu un GUID');
  const adminGroups = guidList('BACKUP365_OIDC_ADMIN_GROUPS', env['BACKUP365_OIDC_ADMIN_GROUPS']);
  const operatorGroups = guidList(
    'BACKUP365_OIDC_OPERATOR_GROUPS',
    env['BACKUP365_OIDC_OPERATOR_GROUPS'],
  );
  if (adminGroups.length + operatorGroups.length === 0) {
    throw new Error(
      'BACKUP365_OIDC_ADMIN_GROUPS ou BACKUP365_OIDC_OPERATOR_GROUPS manquant : aucun groupe ne donnerait de rôle',
    );
  }
  const redirectUri = env['BACKUP365_OIDC_REDIRECT_URI']!;
  let url: URL | undefined;
  try {
    url = new URL(redirectUri);
  } catch {
    url = undefined;
  }
  const local = url !== undefined && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    !url ||
    url.pathname !== OIDC_CALLBACK_PATH ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
  ) {
    throw new Error(
      `BACKUP365_OIDC_REDIRECT_URI invalide : attendu https://<hôte>${OIDC_CALLBACK_PATH} (http seulement pour localhost)`,
    );
  }
  return {
    tenantId: tenantId.toLowerCase(),
    clientId: env['BACKUP365_OIDC_CLIENT_ID']!,
    clientSecret: env['BACKUP365_OIDC_CLIENT_SECRET']!,
    redirectUri,
    adminGroups,
    operatorGroups,
  };
}

/** Pourquoi une connexion Microsoft est refusée (code d'audit et de la page de connexion). */
export type OidcFailure =
  | 'invalid_request' // état ou cookie absent, périmé ou déjà utilisé
  | 'provider_error' // refus ou panne du fournisseur
  | 'invalid_token' // jeton illisible, mal signé, périmé, mauvais émetteur ou public
  | 'no_group' // aucun groupe reconnu
  | 'account_conflict' // le nom est déjà pris par un compte local
  | 'disabled';

export class OidcError extends Error {
  constructor(
    readonly code: OidcFailure,
    /** Identité vérifiée (signature comprise), pour consigner un refus nominatif. */
    readonly username?: string,
    readonly subject?: string,
  ) {
    super(code);
  }
}

export interface OidcIdentity {
  subject: string;
  username: string;
  role: Role;
}

export type OidcFetch = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_BODY = 1_000_000;
const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 1000;
const JWKS_TTL_MS = 60 * 60_000;
const JWKS_RETRY_MS = 60_000;
const SKEW_S = 60;
const TIMEOUT_MS = 10_000;

const b64 = (s: string): Buffer => Buffer.from(s, 'base64url');

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_BODY) throw new OidcError('provider_error');
  return JSON.parse(text) as unknown;
}

interface Pending {
  nonce: string;
  verifier: string;
  at: number;
}

type Jwk = { kty?: string; kid?: string; use?: string; n?: string; e?: string };

/**
 * Connexion OIDC (code d'autorisation + PKCE) avec `node:crypto`, sans dépendance : jetons RS256
 * vérifiés contre le JWKS du fournisseur. `fetch` et l'horloge sont injectables : les tests
 * n'ouvrent aucune connexion réseau.
 */
export class OidcService {
  private readonly pending = new Map<string, Pending>();
  private keys: { at: number; list: Jwk[] } | undefined;
  private lastFetch = 0;

  constructor(
    private readonly config: OidcConfig,
    private readonly endpoints: OidcEndpoints,
    private readonly fetchFn: OidcFetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Début de connexion : adresse d'autorisation, et `state` à lier au navigateur par un cookie. */
  start(): { url: string; state: string } {
    const now = this.now();
    if (this.pending.size >= MAX_PENDING) {
      for (const [k, p] of this.pending) if (now - p.at >= PENDING_TTL_MS) this.pending.delete(k);
      // Encore plein : on retire les plus anciens plutôt que de grossir sans fin.
      for (const k of [...this.pending.keys()].slice(0, MAX_PENDING / 10)) this.pending.delete(k);
    }
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    this.pending.set(state, { nonce, verifier, at: now });
    const relative = this.endpoints.authorization.startsWith('/');
    const url = new URL(this.endpoints.authorization, 'http://relative.invalid');
    const params: Record<string, string> = {
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: 'openid profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // Adresse relative : seule la démo, dont le « fournisseur » est la console elle-même.
    return { url: relative ? `${url.pathname}${url.search}` : url.toString(), state };
  }

  /** Le `state` est connu et non périmé (sans le consommer). */
  knows(state: string): boolean {
    const p = this.pending.get(state);
    return p !== undefined && this.now() - p.at < PENDING_TTL_MS;
  }

  /** Abandon (refus à l'écran du fournisseur) : le `state` ne sert plus. */
  cancel(state: string): void {
    this.pending.delete(state);
  }

  /**
   * Fin de connexion : échange le code, vérifie le jeton d'identité et en tire le rôle. `state`
   * ne sert qu'une fois, même en cas d'échec.
   */
  async finish(code: string, state: string): Promise<OidcIdentity> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || this.now() - pending.at >= PENDING_TTL_MS) {
      throw new OidcError('invalid_request');
    }
    const idToken = await this.exchange(code, pending.verifier);
    return this.identity(await this.verifyIdToken(idToken, pending.nonce));
  }

  private async exchange(code: string, verifier: string): Promise<string> {
    try {
      const res = await this.fetchFn(this.endpoints.token, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new OidcError('provider_error');
      const body = (await readJson(res)) as { id_token?: unknown };
      if (typeof body.id_token !== 'string') throw new OidcError('provider_error');
      return body.id_token;
    } catch (err) {
      throw err instanceof OidcError ? err : new OidcError('provider_error');
    }
  }

  private async keyFor(kid: string): Promise<Jwk | undefined> {
    const now = this.now();
    const find = () => this.keys?.list.find((k) => k.kid === kid);
    if (this.keys && now - this.keys.at < JWKS_TTL_MS && find()) return find();
    // Clé inconnue ou cache périmé : une relecture par minute au plus (un jeton forgé ne doit pas
    // faire appeler le fournisseur à chaque requête).
    if (this.keys && now - this.lastFetch < JWKS_RETRY_MS) return find();
    this.lastFetch = now;
    try {
      const res = await this.fetchFn(this.endpoints.jwks, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('jwks');
      const body = (await readJson(res)) as { keys?: unknown };
      if (!Array.isArray(body.keys)) throw new Error('jwks');
      this.keys = { at: now, list: body.keys as Jwk[] };
    } catch {
      throw new OidcError('provider_error');
    }
    return find();
  }

  private async verifyIdToken(token: string, nonce: string): Promise<Record<string, unknown>> {
    const bad = () => new OidcError('invalid_token');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw bad();
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: unknown; kid?: unknown };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(b64(h).toString('utf8')) as typeof header;
      claims = JSON.parse(b64(p).toString('utf8')) as typeof claims;
    } catch {
      throw bad();
    }
    // Algorithme imposé : ni `none`, ni HS256 signé avec la clé publique.
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw bad();
    const jwk = await this.keyFor(header.kid);
    if (!jwk || jwk.kty !== 'RSA' || jwk.use === 'enc') throw bad();
    let ok: boolean;
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw bad();
      ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, b64(s));
    } catch {
      throw bad();
    }
    if (!ok) throw bad();
    const now = this.now() / 1000;
    const aud = claims['aud'];
    const audOk =
      aud === this.config.clientId || (Array.isArray(aud) && aud.includes(this.config.clientId));
    const { exp, nbf } = claims as { exp?: unknown; nbf?: unknown };
    if (
      claims['iss'] !== this.endpoints.issuer ||
      !audOk ||
      typeof exp !== 'number' ||
      exp + SKEW_S <= now ||
      (nbf !== undefined && (typeof nbf !== 'number' || nbf - SKEW_S > now)) ||
      claims['nonce'] !== nonce
    ) {
      throw bad();
    }
    return claims;
  }

  private identity(claims: Record<string, unknown>): OidcIdentity {
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
    const subject = text(claims['oid']) ?? text(claims['sub']);
    const username =
      text(claims['preferred_username']) ?? text(claims['upn']) ?? text(claims['email']);
    // eslint-disable-next-line no-control-regex
    const control = /[\u0000-\u001f\u007f]/;
    if (!subject || !username || username.length < 3 || username.length > 256) {
      throw new OidcError('invalid_token');
    }
    if (control.test(username)) throw new OidcError('invalid_token');
    const groups = Array.isArray(claims['groups'])
      ? claims['groups']
          .filter((g): g is string => typeof g === 'string')
          .map((g) => g.toLowerCase())
      : [];
    const has = (wanted: readonly string[]) => groups.some((g) => wanted.includes(g));
    // Le rôle le plus fort l'emporte ; un jeton sans groupe reconnu n'ouvre rien.
    const role: Role | undefined = has(this.config.adminGroups)
      ? 'admin'
      : has(this.config.operatorGroups)
        ? 'operator'
        : undefined;
    if (!role) throw new OidcError('no_group', username, subject);
    return { subject, username, role };
  }
}
