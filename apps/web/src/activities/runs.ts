import type { FailureCause } from '@backup365/core';
import { requestError } from '../apiError.js';
import { failureText } from '../failureText.js';
import { NBSP } from '../format.js';
import type { PillStatus } from '../ui/index.js';

/** Page « Activités › Sauvegardes » : l'historique des exécutions des plans. */
export const RUNS_HASH = '#/activites';
export const runsHash = (planId: string): string =>
  `${RUNS_HASH}?plan=${encodeURIComponent(planId)}`;

/** Les exécutions en échec, tous plans confondus : le filtre « Résultat : En échec » déjà réglé. */
export const FAILED_RUNS_HASH = `${RUNS_HASH}?resultat=echec`;

/** Résultat de départ du filtre selon l'ancre : `failed` pour `FAILED_RUNS_HASH`, sinon tous. */
export const runsResultOf = (hash: string): RunResult | '' =>
  hash === FAILED_RUNS_HASH ? 'failed' : '';

/** Plan demandé par l'ancre (`#/activites?plan=<id>`) ; `''` pour tous ; `null` si l'ancre est autre. */
export function parseRunsHash(hash: string): string | null {
  if (hash === RUNS_HASH || hash === FAILED_RUNS_HASH) return '';
  const m = /^#\/activites\?plan=([^&]+)$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export const RUN_RESULTS = ['success', 'failed', 'interrupted', 'running'] as const;
export type RunResult = (typeof RUN_RESULTS)[number];

/** Une exécution telle que `GET /api/runs` la rend (jamais le code d'erreur brut). */
export interface RunItem {
  id: number;
  planId: string;
  planName: string;
  itemId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  result: RunResult;
  itemsSaved: number | null;
  sourceBytes: number | null;
  failureCause?: FailureCause;
}

/**
 * Une exécution de plan : les résultats par source d'un même lancement (le serveur inscrit une
 * ligne par boîte). Les champs de `RunItem` sont ceux de l'ensemble.
 */
export interface RunEvent extends RunItem {
  /** Les résultats par source, dans l'ordre du serveur ; au moins un. */
  runs: RunItem[];
}

/** Le pire résultat l'emporte : une source en échec met toute l'exécution « En échec ». */
const RESULT_RANK: Record<RunResult, number> = {
  failed: 0,
  running: 1,
  interrupted: 2,
  success: 3,
};

const sumOf = (values: readonly (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

/**
 * Écart toléré entre la fin d'une source et le début de la suivante d'une même exécution : le
 * planificateur sauvegarde les sources d'un plan l'une après l'autre, chacune avec son début.
 */
export const RUN_CHAIN_GAP_MS = 60_000;

/** Vrai si `older` appartient à la même exécution que `next`, la source suivante du même plan. */
function chained(older: RunItem, next: RunItem): boolean {
  if (older.startedAt === next.startedAt) return true;
  if (older.finishedAt === null) return false;
  const gap = Date.parse(next.startedAt) - Date.parse(older.finishedAt);
  return gap >= 0 && gap <= RUN_CHAIN_GAP_MS;
}

/**
 * Regroupe les résultats par source (`GET /api/runs`, du plus récent au plus ancien) en exécutions :
 * même plan, chaque source une fois, et même début (lancement manuel) ou début qui suit la fin de
 * la source précédente (passage du planificateur). L'ordre du serveur est conservé.
 */
export function groupRuns(items: readonly RunItem[]): RunEvent[] {
  const groups: RunItem[][] = [];
  const current = new Map<string, RunItem[]>();
  for (const run of items) {
    const runs = current.get(run.planId);
    const earliest = runs?.[runs.length - 1];
    if (runs && earliest && !runs.some((r) => r.itemId === run.itemId) && chained(run, earliest)) {
      runs.push(run);
      continue;
    }
    const group = [run];
    groups.push(group);
    current.set(run.planId, group);
  }
  return groups.map((runs) => {
    const [first] = runs as [RunItem, ...RunItem[]];
    const worst = runs.reduce((a, b) => (RESULT_RANK[b.result] < RESULT_RANK[a.result] ? b : a));
    const open = runs.some((r) => r.durationMs === null || r.finishedAt === null);
    const started = runs.map((r) => r.startedAt).sort()[0] ?? first.startedAt;
    const finished = runs.map((r) => r.finishedAt ?? '').sort()[runs.length - 1] ?? null;
    const span = finished === null ? NaN : Date.parse(finished) - Date.parse(started);
    const event: RunEvent = {
      ...first,
      // Le numéro d'exécution cité par « À faire » est celui de la source en échec.
      id: worst.id,
      // Le début de l'exécution est celui de sa première source.
      startedAt: started,
      result: worst.result,
      finishedAt: open ? null : finished,
      durationMs: open
        ? null
        : Number.isFinite(span)
          ? Math.max(0, span)
          : Math.max(...runs.map((r) => r.durationMs ?? 0)),
      itemsSaved: sumOf(runs.map((r) => r.itemsSaved)),
      sourceBytes: sumOf(runs.map((r) => r.sourceBytes)),
      runs,
    };
    delete event.failureCause;
    if (worst.failureCause !== undefined) event.failureCause = worst.failureCause;
    return event;
  });
}

/**
 * Exécutions d'une liste de `limit` résultats au plus : si la liste est pleine, la plus ancienne
 * exécution a pu perdre des sources au-delà de la limite, elle n'est pas montrée (sauf si seule).
 */
export function completeRuns(items: readonly RunItem[], limit: number): RunEvent[] {
  const events = groupRuns(items);
  return items.length >= limit && events.length > 1 ? events.slice(0, -1) : events;
}

/** Vrai si le plan ne sauvegarde que des boîtes mail : ses sources se comptent en « boîtes ». */
export const mailOnlyTypes = (types: readonly string[] | undefined): boolean =>
  (types?.length ?? 0) > 0 && !!types?.every((t) => t === 'mail');

/** « 5 boîtes », « 1 source » : le nom des sources dépend de ce que le plan sauvegarde. */
export function sourcesLabel(n: number, mailOnly: boolean): string {
  return mailOnly
    ? `${n}${NBSP}${n < 2 ? 'boîte' : 'boîtes'}`
    : `${n}${NBSP}${n < 2 ? 'source' : 'sources'}`;
}

export interface RunsResponse {
  items: RunItem[];
  limit: number;
}

export interface RunsFilter {
  planId: string;
  result: RunResult | '';
  /** Nombre d'exécutions (1 à 20) ; le serveur en rend 20 sans limite. */
  limit?: number;
}

/** Dernières exécutions selon le filtre ; lève si la réponse n'est pas en 2xx. */
export async function fetchRuns(
  filter: RunsFilter,
  fetchFn: typeof fetch = fetch,
): Promise<RunsResponse> {
  const params = new URLSearchParams();
  if (filter.planId) params.set('planId', filter.planId);
  if (filter.result) params.set('result', filter.result);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  const query = params.toString();
  const res = await fetchFn(`/api/runs${query ? `?${query}` : ''}`);
  if (!res.ok) throw requestError(res);
  return (await res.json()) as RunsResponse;
}

// ---- Libellés -------------------------------------------------------------------------------

export const RESULT_VIEW: Record<RunResult, { status: PillStatus; label: string }> = {
  success: { status: 'compliant', label: 'Réussie' },
  failed: { status: 'failed', label: 'En échec' },
  interrupted: { status: 'late', label: 'Interrompue' },
  running: { status: 'running', label: 'En cours' },
};

/**
 * Cause et conduite à tenir d'une exécution en échec ou interrompue, selon le rôle : la table
 * commune avec Plans de protection (`FAILURE_TEXT`, #602) ; `null` sinon.
 */
export function causeOf(run: Pick<RunItem, 'result' | 'failureCause'>, admin: boolean) {
  if (run.result === 'interrupted') return failureText('interrupted', admin);
  if (run.result !== 'failed') return null;
  return failureText(run.failureCause, admin);
}

/** « moins d'une minute », « 14 min », « 1 h 05 » ; « — » sans durée. */
export function durationLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `moins${NBSP}d’une${NBSP}minute`;
  if (minutes < 60) return `${minutes}${NBSP}min`;
  return `${Math.floor(minutes / 60)}${NBSP}h${NBSP}${String(minutes % 60).padStart(2, '0')}`;
}

/** « 1 284 » (espace insécable fine) ; « — » si le moteur ne l'a pas dit. */
export const countLabel = (n: number | null): string =>
  n === null ? '—' : n.toLocaleString('fr-FR');

/** « 1 284 éléments copiés », « 1 élément copié » ; vide si le moteur ne l'a pas dit. */
export function copiedLabel(n: number | null): string {
  if (n === null) return '';
  return `${countLabel(n)} ${n < 2 ? 'élément copié' : 'éléments copiés'}`;
}

/** « 3,2 Go », « 840 Mo » (unités décimales, virgule) ; `null` si la taille n'est pas connue. */
export function volumeLabel(bytes: number | null): string | null {
  if (bytes === null) return null;
  const one = (n: number) => n.toFixed(1).replace('.', ',');
  if (bytes >= 1e9) return `${one(bytes / 1e9)}${NBSP}Go`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)}${NBSP}Mo`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}${NBSP}Ko`;
  return `${bytes}${NBSP}o`;
}

export const RUNS_MESSAGES = {
  intro:
    'Exécutions des plans de protection, de la plus récente à la plus ancienne. Des compteurs seulement : aucun contenu sauvegardé n’est affiché.',
  loading: 'Chargement des exécutions…',
  error: 'L’historique n’a pas pu être chargé. Réessayez dans un instant.',
  emptyAll: 'Aucune exécution pour l’instant. La première sauvegarde aura lieu à l’heure prévue.',
  emptyPlan:
    'Ce plan n’a pas encore été exécuté. La première sauvegarde aura lieu à l’heure prévue.',
  emptyFiltered: 'Aucune exécution ne correspond à ces filtres.',
  footer: (limit: number) => `Seules les ${limit} dernières exécutions sont affichées.`,
  unknownSize: 'non communiquée',
} as const;
