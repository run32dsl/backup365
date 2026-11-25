import { readFailure, requestError } from '../apiError.js';
import { UNREACHABLE, type Outcome } from '../session.js';
import { payloadOf, type PlanForm } from './form.js';
import { MESSAGES, type Mailbox, type PlanItem } from './model.js';

// ---- Ancres ---------------------------------------------------------------------------------

export const PLANS_HASH = '#/plans';
/** Liste des plans réduite à ceux en échec (bouton « Voir l'erreur » de l'accueil). */
export const FAILED_PLANS_HASH = '#/plans?etat=echec';
export const NEW_PLAN_HASH = '#/plans/nouveau';
export const editHash = (id: string): string => `#/plans/${encodeURIComponent(id)}/modifier`;

export type PlansRoute =
  { page: 'list'; failedOnly?: boolean } | { page: 'new' } | { page: 'edit'; id: string };

/** Écran des plans demandé par l'ancre, ou `null` si l'ancre est autre. */
export function parsePlansHash(hash: string): PlansRoute | null {
  if (hash === PLANS_HASH) return { page: 'list' };
  if (hash === FAILED_PLANS_HASH) return { page: 'list', failedOnly: true };
  if (hash === NEW_PLAN_HASH) return { page: 'new' };
  const m = /^#\/plans\/([^/]+)\/modifier$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    return { page: 'edit', id: decodeURIComponent(m[1]) };
  } catch {
    return null;
  }
}

// ---- Réseau ---------------------------------------------------------------------------------

/** Liste des plans ; lève si la réponse n'est pas en 2xx. */
export async function fetchPlans(fetchFn: typeof fetch = fetch): Promise<PlanItem[]> {
  const res = await fetchFn('/api/plans');
  if (!res.ok) throw requestError(res);
  return ((await res.json()) as { items: PlanItem[] }).items;
}

/**
 * Boîtes du catalogue pour le périmètre choisi. `configured: false` quand le stockage n'est pas
 * configuré (503 `catalog_unavailable`) ; toute autre erreur laisse `configured` à `true`.
 */
export async function fetchMailboxes(
  fetchFn: typeof fetch = fetch,
): Promise<{ configured: boolean; mailboxes: Mailbox[] }> {
  try {
    const res = await fetchFn('/api/mailboxes');
    if (res.status === 503) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (body?.error === 'catalog_unavailable') return { configured: false, mailboxes: [] };
    }
    if (!res.ok) return { configured: true, mailboxes: [] };
    const body = (await res.json()) as { mailboxes: Mailbox[] };
    return { configured: true, mailboxes: body.mailboxes };
  } catch {
    return { configured: true, mailboxes: [] };
  }
}

const SERVER_MESSAGES: Record<string, string> = {
  plan_name_taken: MESSAGES.nameTaken,
  plan_not_found: 'Ce plan n’existe plus.',
  run_in_progress: 'Une sauvegarde est déjà en cours pour ce plan.',
  no_items: 'Ce plan ne couvre aucune boîte : rien à sauvegarder.',
  reason_required: MESSAGES.runReason,
  invalid_plan: 'Le plan n’est pas valide : vérifiez les champs.',
  forbidden: MESSAGES.forbidden,
};

async function send<T>(
  fetchFn: typeof fetch,
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
  read?: (res: Response) => Promise<T>,
): Promise<Outcome<T>> {
  try {
    const res = await fetchFn(url, {
      method,
      ...(payload
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
        : {}),
    });
    if (!res.ok) {
      const failure = await readFailure(res, SERVER_MESSAGES);
      return { ok: false, ...failure };
    }
    return { ok: true, value: (await read?.(res)) as T };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

export const createPlan = (form: PlanForm, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'POST', '/api/plans', payloadOf(form), async (r) => (await r.json()) as PlanItem);

export const updatePlan = (id: string, form: PlanForm, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'PUT', `/api/plans/${encodeURIComponent(id)}`, payloadOf(form));

export const deletePlan = (id: string, reason: string, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'DELETE', `/api/plans/${encodeURIComponent(id)}`, { reason: reason.trim() });

/** Motif d'un lancement manuel : le même texte libre que partout, refusé s'il est vide. */
export const runReasonError = (reason: string): string | undefined =>
  reason.trim() === '' ? MESSAGES.runReason : undefined;

export const runPlan = (id: string, reason: string, fetchFn: typeof fetch = fetch) =>
  send(
    fetchFn,
    'POST',
    `/api/plans/${encodeURIComponent(id)}/run`,
    { reason: reason.trim() },
    async (r) => ({ queued: ((await r.json()) as { queued?: boolean }).queued === true }),
  );
