import { useEffect, useState } from 'react';
import { dayOf, elements, plural, sizeOf } from '../format.js';
import { ResultList } from '../ui/index.js';
import { retentionLabel, type PlanItem } from './model.js';

/** Ce qui dépasse la durée de conservation d'un plan (`GET /api/plans/retention`, issue #79). */
export interface RetentionExcessItem {
  planId: string;
  retentionDays: number;
  cutoff: string;
  snapshots: number;
  items: number;
  bytes: number;
  oldestAt: string | null;
}

export type RetentionState = RetentionExcessItem[] | 'loading' | 'error';

export const RETENTION_TEXT = {
  title: 'Conservation (simulation)',
  intro:
    'Conservation non appliquée pour l’instant : rien n’est supprimé. Voici ce qui dépasse aujourd’hui la durée fixée par chaque plan.',
  loading: 'Calcul de la simulation…',
  error: 'Simulation indisponible : le stockage des sauvegardes ne répond pas.',
} as const;

/** Simulation de conservation ; lève si la réponse n'est pas en 2xx. */
export async function fetchRetention(
  fetchFn: typeof fetch = fetch,
): Promise<RetentionExcessItem[]> {
  const res = await fetchFn('/api/plans/retention');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { items: RetentionExcessItem[] }).items;
}

/**
 * « Durée 90 jours : 2 points de restauration (1 élément) antérieurs au 28/08/2026, 1,9 Go. »,
 * ou « Durée 1 an : rien ne la dépasse. »
 */
export function excessLabel(x: RetentionExcessItem): string {
  const head = `Durée ${retentionLabel(x.retentionDays)} : `;
  if (x.snapshots === 0) return `${head}rien ne la dépasse.`;
  const before = x.snapshots < 2 ? 'antérieur' : 'antérieurs';
  return `${head}${plural(x.snapshots, 'point')} de restauration (${elements(x.items)}) ${before} au ${dayOf(x.cutoff)}, ${sizeOf(x.bytes)}.`;
}

/** Liste de la simulation, une ligne par plan, sans accès réseau (testable telle quelle). */
export function RetentionView({
  state,
  plans,
}: {
  state: RetentionState;
  plans: readonly PlanItem[];
}) {
  const names = new Map(plans.map((p) => [p.id, p.name]));
  const rows: [string, string][] = Array.isArray(state)
    ? state.flatMap((x) => {
        const name = names.get(x.planId);
        return name === undefined ? [] : [[name, excessLabel(x)] as [string, string]];
      })
    : [];
  return (
    <section aria-labelledby="retention-title" aria-busy={state === 'loading'}>
      <h2 id="retention-title">{RETENTION_TEXT.title}</h2>
      <p>{RETENTION_TEXT.intro}</p>
      {state === 'loading' && <p role="status">{RETENTION_TEXT.loading}</p>}
      {state === 'error' && <p role="status">{RETENTION_TEXT.error}</p>}
      {rows.length > 0 && <ResultList rows={rows} />}
    </section>
  );
}

/** Section « Conservation (simulation) » de la liste des plans, pour l'administrateur. */
export function RetentionSimulation({ plans }: { plans: readonly PlanItem[] }) {
  const [state, setState] = useState<RetentionState>('loading');
  // Relue quand la liste des plans change (création, modification de la durée, suppression).
  const key = plans.map((p) => `${p.id}:${p.retentionDays}`).join(',');
  useEffect(() => {
    let live = true;
    fetchRetention().then(
      (items) => {
        if (live) setState(items);
      },
      () => {
        if (live) setState('error');
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  if (plans.length === 0) return null;
  return <RetentionView state={state} plans={plans} />;
}
