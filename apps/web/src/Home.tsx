import { useEffect, useState } from 'react';
import type { HealthResponse } from '@backup365/core';
import { fetchHealth } from './health.js';
import { NoBackupError, fetchStatus } from './status.js';
import { StatusView, type StatusState } from './StatusView.js';

/** État de la vérification du serveur. */
export type HealthState = HealthResponse | 'loading' | 'error';

/** Affiche l'état du serveur. */
export function HealthView({ state }: { state: HealthState }) {
  return (
    <p role="status">
      {state === 'loading'
        ? 'Vérification du serveur…'
        : state === 'error'
          ? 'Serveur injoignable'
          : `Serveur : ${state.status} (version ${state.version})`}
    </p>
  );
}

/** Page d'accueil : interroge `/api/health` au montage. */
export function Home() {
  const [state, setState] = useState<HealthState>('loading');
  useEffect(() => {
    fetchHealth().then(setState, () => setState('error'));
  }, []);
  const [status, setStatus] = useState<StatusState>('loading');
  useEffect(() => {
    fetchStatus().then(setStatus, (err: unknown) =>
      setStatus(err instanceof NoBackupError ? 'empty' : 'error'),
    );
  }, []);
  return (
    <main>
      <h1>backup365</h1>
      <HealthView state={state} />
      <StatusView state={status} />
    </main>
  );
}
