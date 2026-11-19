import { useEffect, useState } from 'react';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView, type StatusState } from './StatusView.js';

/** État détaillé des sauvegardes et conformité des plans : page réservée aux administrateurs. */
export function StatusPage() {
  const [status, setStatus] = useState<StatusState>('loading');
  useEffect(() => {
    fetchStatus().then(setStatus, (err: unknown) => {
      setStatus(err instanceof NoBackupError ? 'empty' : 'error');
    });
  }, []);
  return (
    <main tabIndex={-1}>
      <h1>État détaillé</h1>
      <StatusView state={status} />
    </main>
  );
}
