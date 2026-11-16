import { useEffect, useState } from 'react';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView, type StatusState } from './StatusView.js';

/** Page d'accueil : l'état des sauvegardes. La version du serveur est dans le pied de page. */
export function Home() {
  const [status, setStatus] = useState<StatusState>('loading');
  useEffect(() => {
    fetchStatus().then(setStatus, (err: unknown) =>
      setStatus(err instanceof NoBackupError ? 'empty' : 'error'),
    );
  }, []);
  return (
    <main tabIndex={-1}>
      <h1>Tableau de bord</h1>
      <StatusView state={status} />
    </main>
  );
}
