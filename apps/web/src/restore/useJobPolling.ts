import { useEffect } from 'react';

/** Ce qu'il faut savoir d'une restauration pour la suivre, quelle que soit la source. */
interface PolledJob {
  id: string;
  status: string;
  error: 'restore_error' | 'restore_unreachable' | 'restore_lost' | null;
  durationMs: number | null;
}

/** Échecs de lecture de suite après lesquels on cesse d'attendre la restauration. */
export const MAX_POLL_FAILURES = 5;

/**
 * Relit le dernier travail chaque seconde, jusqu'à l'arrêt (valeur rendue). Si le serveur en a
 * perdu la trace (redémarrage) ou après `MAX_POLL_FAILURES` échecs de suite (session expirée,
 * serveur arrêté), la restauration est donnée pour perdue : on n'attend pas indéfiniment.
 */
export function startPolling<J extends PolledJob>(
  job: J,
  fetchLast: () => Promise<J | null | undefined>,
  onJob: (job: J) => void,
): () => void {
  let current = true;
  let failures = 0;
  const lost = () => {
    onJob({ ...job, status: 'failed', error: 'restore_lost', durationMs: null });
  };
  const timer = setInterval(() => {
    fetchLast().then(
      (last) => {
        if (!current) return;
        failures = 0;
        if (last && last.id === job.id && last.status !== 'running') onJob(last);
        else if (!last || last.id !== job.id) lost();
      },
      () => {
        failures += 1;
        if (current && failures >= MAX_POLL_FAILURES) lost();
      },
    );
  }, 1000);
  return () => {
    current = false;
    clearInterval(timer);
  };
}

/**
 * Suit une restauration en cours (voir `startPolling`). `onJob` doit être stable (état du
 * parent) ; `deps` liste ce qui identifie le travail suivi.
 */
export function useJobPolling<J extends PolledJob>(
  job: J,
  fetchLast: () => Promise<J | null | undefined>,
  onJob: (job: J) => void,
  deps: readonly unknown[],
): void {
  const running = job.status === 'running';
  useEffect(() => {
    if (!running) return;
    return startPolling(job, fetchLast, onJob);
    // `job` ne change que par `onJob` ; `onJob` est stable (état du parent).
  }, [running, ...deps]);
}
