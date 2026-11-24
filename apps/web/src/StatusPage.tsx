import { useEffect, useState } from 'react';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView, type StatusState } from './StatusView.js';

/** Charge l'état : « aucune sauvegarde » devient `empty`, toute autre erreur `error`. */
export function loadStatus(fetchStatusFn: typeof fetchStatus = fetchStatus): Promise<StatusState> {
  return fetchStatusFn().then(
    (report): StatusState => report,
    (err: unknown): StatusState => (err instanceof NoBackupError ? 'empty' : 'error'),
  );
}

/** État détaillé des sauvegardes et conformité des plans : page réservée aux administrateurs. */
export function StatusPage() {
  const [status, setStatus] = useState<StatusState>('loading');
  useEffect(() => {
    void loadStatus().then(setStatus);
  }, []);
  return (
    <main tabIndex={-1}>
      <h1>État détaillé</h1>
      <StatusView state={status} />
    </main>
  );
}
