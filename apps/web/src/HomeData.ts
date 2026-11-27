import type { StatusReport } from '@backup365/core';
import { useCallback, useState } from 'react';
import { fetchRuns, type RunItem } from './activities/runs.js';
import { LATEST_RESULTS, coverageOf, type Coverage } from './HomeCoverage.js';
import { fetchMailboxes, fetchPlans, type PlanItem } from './plans.js';
import { fetchStatus } from './status.js';
import { storageBlocked } from './StorageBlocked.js';

/** Données des blocs du bas, chargées par l'accueil en même temps que `GET /api/overview`. */
export interface HomeData {
  coverage: Coverage | 'loading' | 'error';
  plans: PlanItem[] | 'loading' | 'error';
  events: RunItem[] | 'loading' | 'error';
  /** Stockage bloqué, lu sur la même réponse que la couverture (administrateur, #612). */
  storageBlocked?: boolean;
  /** Nom de chaque boîte, lu comme Activités : la source de « Derniers événements » (#636). */
  names?: ReadonlyMap<string, string>;
}

/**
 * Couverture, plans et exécutions (celles-ci pour l'administrateur seulement), lus une fois par
 * `load` ; `loadEvents` relit les seules exécutions (« Réessayer » de « Derniers événements »).
 */
export function useHomeData(admin: boolean): HomeData & {
  load: () => void;
  loadEvents: () => void;
} {
  const [coverage, setCoverage] = useState<HomeData['coverage']>('loading');
  const [plans, setPlans] = useState<HomeData['plans']>('loading');
  const [events, setEvents] = useState<HomeData['events']>('loading');
  const [blocked, setBlocked] = useState(false);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const loadEvents = useCallback(() => {
    if (!admin) return;
    setEvents('loading');
    fetchRuns({ planId: '', result: '', limit: LATEST_RESULTS }).then(
      (page) => setEvents(page.items),
      () => setEvents('error'),
    );
  }, [admin]);
  const load = useCallback(() => {
    fetchStatus().then(
      (report: StatusReport) => {
        setCoverage(coverageOf(report.rows));
        setBlocked(storageBlocked(report));
      },
      () => setCoverage('error'),
    );
    fetchPlans().then(setPlans, () => setPlans('error'));
    if (admin) {
      void fetchMailboxes().then(({ mailboxes }) =>
        setNames(new Map(mailboxes.map((m) => [m.id, m.displayName]))),
      );
    }
    loadEvents();
  }, [admin, loadEvents]);
  return { coverage, plans, events, storageBlocked: blocked, names, load, loadEvents };
}
