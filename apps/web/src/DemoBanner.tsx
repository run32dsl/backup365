import { useEffect, useState } from 'react';
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

/** Interroge `/api/health` une fois : seul le serveur sait s'il est en mode démo. */
export function useDemo(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let current = true;
    fetchHealth().then(
      (h) => {
        if (current) setDemo(h.demo === true);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return demo;
}
