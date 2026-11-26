import type { FailureCause } from '@backup365/core';
import { requestError } from '../apiError.js';
import { NBSP } from '../format.js';
import type { PillStatus } from '../ui/index.js';

/** Page « Activités › Sauvegardes » : l'historique des exécutions des plans. */
export const RUNS_HASH = '#/activites';
export const runsHash = (planId: string): string =>
  `${RUNS_HASH}?plan=${encodeURIComponent(planId)}`;

/** Plan demandé par l'ancre (`#/activites?plan=<id>`) ; `''` pour tous ; `null` si l'ancre est autre. */
export function parseRunsHash(hash: string): string | null {
  if (hash === RUNS_HASH) return '';
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

/** Cause et marche à suivre de chaque échec, en français ; `unknown` sert de repli. */
export const CAUSES: Record<FailureCause, { cause: string; todo: string }> = {
  interrupted: {
    cause: 'la console a été arrêtée pendant l’exécution.',
    todo: 'rien, la prochaine exécution reprendra la sauvegarde.',
  },
  backup_errors: {
    cause: 'des dossiers ou des fichiers n’ont pas pu être sauvegardés.',
    todo: 'vérifier l’autorisation de l’application Microsoft 365 et l’accès au stockage, puis relancer le plan.',
  },
  no_result: {
    cause: 'aucune donnée n’a été sauvegardée pour cette source.',
    todo: 'vérifier que la source existe toujours dans Microsoft 365, puis relancer le plan.',
  },
  owner_busy: {
    cause: 'une autre opération (sauvegarde ou restauration) était déjà en cours sur cette source.',
    todo: 'rien, la prochaine exécution reprendra la sauvegarde ; pour la relancer tout de suite, attendre quelques minutes.',
  },
  access_refused: {
    cause: 'Microsoft 365 a refusé l’accès à cette source.',
    todo: 'vérifier les autorisations accordées à l’application Microsoft 365, puis relancer le plan.',
  },
  graph_unavailable: {
    cause: 'Microsoft 365 n’a pas répondu, malgré plusieurs essais.',
    todo: 'rien, la prochaine exécution reprendra la sauvegarde.',
  },
  storage_unavailable: {
    cause: 'le stockage des sauvegardes n’a pas répondu, malgré plusieurs essais.',
    todo: 'vérifier que le stockage est joignable, puis relancer le plan.',
  },
  format_unsupported: {
    cause:
      'les sauvegardes existantes sont dans un format que cette version ne prend pas en charge.',
    todo: 'mettre la console à jour, puis relancer le plan.',
  },
  write_refused: {
    cause:
      'le moteur de sauvegarde a refusé d’écrire des données qu’il n’aurait pas pu relire ; rien n’a été écrit.',
    todo: 'relancer le plan ; si cela se reproduit, transmettre le numéro d’exécution à un administrateur.',
  },
  unknown: {
    cause: 'la sauvegarde a échoué pour une raison non identifiée.',
    todo: 'relancer le plan\u202f; si cela se reproduit, transmettre le numéro d’exécution à un administrateur.',
  },
};

/** Cause d'une exécution en échec ou interrompue ; `null` sinon. */
export function causeOf(run: Pick<RunItem, 'result' | 'failureCause'>) {
  if (run.result === 'interrupted') return CAUSES.interrupted;
  if (run.result !== 'failed') return null;
  return CAUSES[run.failureCause ?? 'unknown'] ?? CAUSES.unknown;
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
