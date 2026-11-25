import { useEffect, useState } from 'react';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView, type StatusState } from './StatusView.js';
import { SourcesNav } from './ui/index.js';

/** Charge l'état : « aucune sauvegarde » devient `empty`, toute autre erreur `error`. */
export function loadStatus(fetchStatusFn: typeof fetchStatus = fetchStatus): Promise<StatusState> {
  return fetchStatusFn().then(
    (report): StatusState => report,
    (err: unknown): StatusState => (err instanceof NoBackupError ? 'empty' : 'error'),
  );
}

/** Page « Sources » : protection par service, conformité des plans et sauvegardes (administrateurs). */
export function StatusPage() {
  const [status, setStatus] = useState<StatusState>('loading');
  useEffect(() => {
    void loadStatus().then(setStatus);
  }, []);
  return (
    <main tabIndex={-1}>
      <h1>État des sources</h1>
      <SourcesNav current="status" admin />
      <p>État de la protection de chaque service Microsoft 365.</p>
      <StatusView state={status} />
    </main>
  );
}
