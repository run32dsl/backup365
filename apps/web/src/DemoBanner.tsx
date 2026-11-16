import { useEffect, useState } from 'react';
import type { HealthResponse } from '@backup365/core';
import { fetchHealth } from './health.js';

export const DEMO_BANNER_TEXT = 'Mode démo : données fictives';

/** Bandeau du mode démo, affiché au-dessus de tous les écrans (connexion comprise). */
export function DemoBanner({ demo }: { demo: boolean }) {
  if (!demo) return null;
  return (
    <div className="demo-banner" role="note">
      {DEMO_BANNER_TEXT}
    </div>
  );
}

/** Interroge `/api/health` une fois : seul le serveur sait s'il est en mode démo, et sa version. */
export type HealthState = HealthResponse | null | 'failed';

/** `null` : réponse pas encore reçue (état inconnu), à ne pas confondre avec « hors démo ». */
export function demoOf(health: HealthState): boolean | null {
  if (health === null) return null;
  return health !== 'failed' && health.demo === true;
}

export function useHealth(): HealthState {
  const [health, setHealth] = useState<HealthState>(null);
  useEffect(() => {
    let current = true;
    fetchHealth().then(
      (h) => {
        if (current) setHealth(h);
      },
      () => {
        if (current) setHealth('failed');
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return health;
}
