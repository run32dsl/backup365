import type { MailMessage } from './mail-report.js';

/**
 * État de l'envoi, sans secret : `unconfigured` nomme ce qui manque côté serveur, `permission`
 * dit que l'application n'a pas `Mail.Send`, `refused` que Microsoft refuse ses identifiants
 * (secret expiré…), `unreachable` que Microsoft n'a pas répondu.
 */
export type MailerStatus =
  | { state: 'ready'; sender: string }
  | { state: 'unconfigured'; missing: 'credentials' | 'sender' }
  | { state: 'permission'; sender: string }
  | { state: 'refused'; sender: string }
  | { state: 'unreachable'; sender: string };

/**
 * Port d'envoi des rapports. Graph aujourd'hui ; un serveur SMTP distinct pourra le remplacer
 * (commentaire du PM du 2026-11-24, ADR 0023).
 */
export interface Mailer {
  status(): Promise<MailerStatus>;
  /** Rejette par `MailSendError` ; jamais un message de Microsoft, qui peut citer une adresse. */
  send(message: MailMessage): Promise<void>;
}

export class MailSendError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MailSendError';
  }
}

/** Adresse simple `nom@domaine.ext`, sans espace ni chevron (pas d'injection d'en-tête). */
export const EMAIL = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Boîte d'envoi (`BACKUP365_REPORT_SENDER`) ; absente, l'envoi reste désactivé. */
export function parseReportSender(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  if (!EMAIL.test(raw.trim()) || raw.trim().length > 254) {
    throw new Error('BACKUP365_REPORT_SENDER invalide : attendu une adresse nom@domaine');
  }
  return raw.trim();
}

/** Rôles d'application du jeton (`roles`), lus sans vérifier la signature : simple diagnostic. */
export function tokenRoles(token: string): string[] {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    const roles = (payload as { roles?: unknown } | null)?.roles;
    return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

const TIMEOUT_MS = 15_000;

export interface GraphMailerOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
  fetch?: typeof fetch;
  loginBase?: string;
  graphBase?: string;
}

/**
 * Envoi par Microsoft Graph `sendMail` avec l'application de la sauvegarde (flux « client
 * credentials »). Le jeton et le secret ne sont ni journalisés ni conservés au-delà de l'appel.
 */
export class GraphMailer implements Mailer {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: GraphMailerOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  private async token(): Promise<string> {
    const { tenantId, clientId, clientSecret } = this.options;
    const base = this.options.loginBase ?? 'https://login.microsoftonline.com';
    let res: Response;
    try {
      res = await this.fetch(`${base}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new MailSendError('token_unreachable');
    }
    if (!res.ok) throw new MailSendError('token_refused');
    const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (typeof body?.access_token !== 'string') throw new MailSendError('token_refused');
    return body.access_token;
  }

  async status(): Promise<MailerStatus> {
    const { sender } = this.options;
    try {
      const roles = tokenRoles(await this.token());
      return roles.includes('Mail.Send')
        ? { state: 'ready', sender }
        : { state: 'permission', sender };
    } catch (err) {
      const refused = err instanceof MailSendError && err.code === 'token_refused';
      return { state: refused ? 'refused' : 'unreachable', sender };
    }
  }

  async send(message: MailMessage): Promise<void> {
    const token = await this.token();
    const base = this.options.graphBase ?? 'https://graph.microsoft.com';
    let res: Response;
    try {
      res = await this.fetch(
        `${base}/v1.0/users/${encodeURIComponent(this.options.sender)}/sendMail`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: 'Text', content: message.text },
              toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
            },
            saveToSentItems: false,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch {
      throw new MailSendError('graph_unreachable');
    }
    if (res.status === 401 || res.status === 403) throw new MailSendError('permission');
    if (!res.ok) throw new MailSendError(`graph_${res.status}`);
  }
}

/** Envoi indisponible : il manque les identifiants Microsoft 365 ou la boîte d'envoi. */
export function unconfiguredMailer(missing: 'credentials' | 'sender'): Mailer {
  return {
    status: () => Promise.resolve({ state: 'unconfigured', missing }),
    send: () => Promise.reject(new MailSendError('not_configured')),
  };
}

/** Boîte d'envoi fictive du mode démo. */
export const DEMO_SENDER = 'sauvegardes@exemple.invalid';

/** Mode démo : l'envoi « réussit » et rien ne quitte la machine. */
export const demoMailer: Mailer = {
  status: () => Promise.resolve({ state: 'ready', sender: DEMO_SENDER }),
  send: () => Promise.resolve(),
};
