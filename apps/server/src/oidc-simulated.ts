import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { OidcConfig, OidcEndpoints, OidcFetch } from './oidc.js';

const b64 = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

export interface SimulatedClaims {
  [claim: string]: unknown;
}

/**
 * Fournisseur OIDC simulé, en mémoire, pour les tests et le mode démo : il signe en RS256 avec une
 * clé générée au lancement, vérifie le secret, la redirection et le PKCE comme Entra ID, et sert
 * son JWKS. Aucun appel réseau : `fetch` répond lui-même. Jamais de vraie identité.
 */
export class SimulatedOidcProvider {
  readonly kid = 'simulated-key-1';
  private readonly privateKey;
  private readonly jwk;
  private readonly codes = new Map<string, { nonce: string; challenge: string }>();
  /** Revendications de l'identité qui « se connecte » (modifiables entre deux connexions). */
  identity: SimulatedClaims;
  /** Appels reçus, pour vérifier qu'une requête refusée n'a rien contacté. */
  readonly calls: string[] = [];

  constructor(
    private readonly config: OidcConfig,
    private readonly endpoints: OidcEndpoints,
    identity: SimulatedClaims,
    private readonly now: () => number = Date.now,
  ) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig' };
    this.identity = identity;
  }

  /** Jeton signé ; `header` et `claims` permettent de fabriquer des jetons défectueux. */
  sign(claims: SimulatedClaims, header: Record<string, unknown> = {}): string {
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid, ...header }));
    const body = b64(JSON.stringify(claims));
    const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(this.privateKey);
    return `${head}.${body}.${b64(signature)}`;
  }

  /** Revendications d'un jeton valide pour cette connexion. */
  claims(nonce: string, extra: SimulatedClaims = {}): SimulatedClaims {
    const iat = Math.floor(this.now() / 1000);
    return {
      iss: this.endpoints.issuer,
      aud: this.config.clientId,
      iat,
      nbf: iat,
      exp: iat + 3600,
      nonce,
      ...this.identity,
      ...extra,
    };
  }

  /**
   * L'utilisateur s'est authentifié et a consenti : renvoie le code à rendre au `redirect_uri`
   * (`undefined` si la demande d'autorisation est incorrecte, comme le fait Entra ID).
   */
  authorize(authorizationUrl: string): { code: string; state: string } | undefined {
    const q = new URL(authorizationUrl, 'http://simulated.invalid').searchParams;
    const state = q.get('state');
    const nonce = q.get('nonce');
    const challenge = q.get('code_challenge');
    if (
      q.get('client_id') !== this.config.clientId ||
      q.get('redirect_uri') !== this.config.redirectUri ||
      q.get('response_type') !== 'code' ||
      q.get('code_challenge_method') !== 'S256' ||
      !state ||
      !nonce ||
      !challenge
    ) {
      return undefined;
    }
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, { nonce, challenge });
    return { code, state };
  }

  /** `fetch` à injecter dans `OidcService` : jeton et clés du fournisseur simulé. */
  readonly fetch: OidcFetch = (url, init) => {
    this.calls.push(url);
    if (url === this.endpoints.jwks) return Promise.resolve(Response.json({ keys: [this.jwk] }));
    if (url !== this.endpoints.token) return Promise.resolve(new Response(null, { status: 404 }));
    const form = new URLSearchParams(String(init?.body));
    const grant = this.codes.get(form.get('code') ?? '');
    // Le code ne sert qu'une fois.
    this.codes.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const ok =
      grant !== undefined &&
      form.get('client_id') === this.config.clientId &&
      form.get('client_secret') === this.config.clientSecret &&
      form.get('redirect_uri') === this.config.redirectUri &&
      createHash('sha256').update(verifier).digest('base64url') === grant.challenge;
    if (!ok) return Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    return Promise.resolve(
      Response.json({ token_type: 'Bearer', id_token: this.sign(this.claims(grant.nonce)) }),
    );
  };
}
