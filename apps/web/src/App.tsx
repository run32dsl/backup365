import { useEffect, useState } from 'react';
import { AuditPage } from './AuditPage.js';
import { Home } from './Home.js';

/** Écran demandé par l'ancre de l'URL : `#/audit` ouvre le journal, tout le reste l'accueil. */
export function screenOf(hash: string): 'audit' | 'home' {
  return hash === '#/audit' ? 'audit' : 'home';
}

/** Navigation minimale par ancre, sans dépendance de routage. */
export function App() {
  const [screen, setScreen] = useState(screenOf(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setScreen(screenOf(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return (
    <>
      <nav>
        <a href="#/">Accueil</a> <a href="#/audit">Journal d’audit</a>
      </nav>
      {screen === 'audit' ? <AuditPage /> : <Home />}
    </>
  );
}
