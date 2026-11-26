import { requestError } from './apiError.js';
import { dateTimeOf } from './format.js';
import { failureOf, type Outcome } from './session.js';

/** Ancre de la vue « Rapports par mail » (Réglages, administrateurs). */
export const REPORTS_HASH = '#/rapports';

export type ReportFrequency = 'weekly' | 'daily';

export interface ReportSettings {
  recipients: string[];
  frequency: ReportFrequency;
  failureAlert: boolean;
}

/** État de l'envoi, tel que le serveur le donne (voir graph-mailer.ts) : jamais un secret. */
export type MailerStatus =
  | { state: 'ready'; sender: string }
  | { state: 'unconfigured'; missing: 'credentials' | 'sender' }
  | { state: 'permission'; sender: string }
  | { state: 'refused'; sender: string }
  | { state: 'unreachable'; sender: string };

export interface LastSend {
  at: string;
  kind: 'report' | 'alert' | 'test';
  ok: boolean;
}

export interface ReportsView {
  settings: ReportSettings;
  mailer: MailerStatus;
  lastSend: LastSend | null;
  /** Nombre de plans de protection : sans plan, le rapport sera vide. */
  plans: number;
}

export const MAX_RECIPIENTS = 20;

export const REPORT_LABELS = {
  recipients: 'Destinataires',
  recipientsHelp: 'Seules ces personnes reçoivent le rapport.',
  recipientsHint: 'Adresses séparées par une virgule ou un retour à la ligne.',
  frequency: 'Fréquence du rapport',
  weekly: 'Chaque semaine, le lundi',
  daily: 'Chaque jour',
  alertLegend: 'Alerte',
  alert: 'Prévenir tout de suite en cas d’échec',
  contentHelp: 'Le rapport ne contient que des compteurs, des durées et l’état des plans.',
  audit: 'Chaque modification est inscrite au journal d’audit.',
  intro:
    'Recevoir un point régulier sur les sauvegardes, et être prévenu tout de suite en cas d’échec.',
  empty: 'Aucun destinataire pour l’instant.',
  noPlan: 'Aucun plan de protection : le rapport sera vide.',
  saved: 'Réglages enregistrés.',
  homeFailure: 'Le dernier rapport n’a pas pu être envoyé',
  homeLink: 'Ouvrir les rapports par mail',
} as const;

export const FIELD_ERRORS = {
  invalid: 'Adresse non valide : vérifiez « nom@domaine ».',
  none: 'Ajoutez au moins un destinataire pour activer le rapport.',
  tooMany: `${MAX_RECIPIENTS} destinataires au plus.`,
} as const;

const EMAIL = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Adresses saisies : séparées par virgule, point-virgule ou retour ; doublons retirés (casse ignorée). */
export function parseRecipients(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\s,;]+/u)
    .map((a) => a.trim())
    .filter((a) => {
      if (a === '' || seen.has(a.toLowerCase())) return false;
      seen.add(a.toLowerCase());
      return true;
    });
}

/** Erreur de saisie du champ « Destinataires », ou `null`. `required` : pour enregistrer et essayer. */
export function recipientsError(list: readonly string[], required: boolean): string | null {
  if (list.some((a) => !EMAIL.test(a) || a.length > 254)) return FIELD_ERRORS.invalid;
  if (list.length > MAX_RECIPIENTS) return FIELD_ERRORS.tooMany;
  return required && list.length === 0 ? FIELD_ERRORS.none : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n < 2 ? one : many}`;

/** Phrases du récapitulatif, en langage clair. */
export function recapLines(settings: ReportSettings): string[] {
  const to = plural(settings.recipients.length, 'destinataire', 'destinataires');
  return [
    settings.frequency === 'weekly'
      ? `Le rapport de la semaine sera envoyé le lundi vers 07:00 UTC à ${to}.`
      : `Le rapport du jour sera envoyé chaque jour vers 07:00 UTC à ${to}.`,
    settings.failureAlert
      ? 'Une alerte partira à chaque échec de sauvegarde.'
      : 'Aucune alerte ne partira en cas d’échec : seul le rapport sera envoyé.',
    'Le rapport contient : état des plans, volume, durée, échecs. Aucun nom de fichier, aucun objet de mail.',
  ];
}

const KIND_LABELS: Record<LastSend['kind'], string> = {
  report: 'rapport',
  alert: 'alerte',
  test: 'essai',
};

/** « 24/11/2026 07:00 UTC (rapport) » : date et nature du dernier envoi. */
export function lastSendLine(send: LastSend): string {
  return `${dateTimeOf(send.at)} UTC (${KIND_LABELS[send.kind]})`;
}

export function testSentMessage(to: readonly string[], at: string): string {
  const who = to.length === 1 ? to[0] : `${to.length} destinataires`;
  return `Essai envoyé à ${who} à ${dateTimeOf(at).slice(11)} UTC.`;
}

export function testFailedMessage(at: string): string {
  return `Échec de l’envoi de l’essai le ${dateTimeOf(at)} UTC. Microsoft 365 a refusé l’envoi. Vérifiez la permission et la boîte d’envoi, puis réessayez ; sinon prévenez l’exploitant du serveur avec l’heure.`;
}

export async function fetchReports(fetchFn: typeof fetch = fetch): Promise<ReportsView> {
  const res = await fetchFn('/api/reports');
  if (!res.ok) throw requestError(res);
  return (await res.json()) as ReportsView;
}

async function call<T>(
  fetchFn: typeof fetch,
  method: 'POST' | 'PUT',
  url: string,
  payload?: object,
): Promise<Outcome<T> & { status?: number; body?: unknown }> {
  const res = await fetchFn(url, {
    method,
    ...(payload && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  });
  if (res.ok) return { ok: true, value: (await res.json()) as T };
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null);
  return { ok: false, status: res.status, body, ...(await failureOf(res)) };
}

export const saveReports = (settings: ReportSettings, fetchFn: typeof fetch = fetch) =>
  call<{ settings: ReportSettings }>(fetchFn, 'PUT', '/api/reports', settings);

export const recheckMailer = (fetchFn: typeof fetch = fetch) =>
  call<{ mailer: MailerStatus }>(fetchFn, 'POST', '/api/reports/check');

/** Essai : `failedAt` est l'heure du refus de Microsoft (502), à citer à l'exploitant. */
export async function sendTestReport(
  recipients: string[],
  frequency: ReportFrequency,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; at: string } | { ok: false; failedAt?: string; message: string }> {
  const out = await call<{ at: string }>(fetchFn, 'POST', '/api/reports/test', {
    recipients,
    frequency,
  });
  if (out.ok) return { ok: true, at: out.value.at };
  const at = (out.body as { at?: unknown } | null)?.at;
  return typeof at === 'string'
    ? { ok: false, failedAt: at, message: testFailedMessage(at) }
    : { ok: false, message: out.message };
}
