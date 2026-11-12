import { useEffect, useState } from 'react';
import { AuditPage } from './AuditPage.js';
import { Home } from './Home.js';
import { MailPage } from './MailPage.js';
import { SearchPage } from './SearchPage.js';
import { parseMailHash } from './mail.js';

/**
 * Écran demandé par l'ancre de l'URL : `#/audit` le journal, `#/search` la recherche,
 * `#/mail/<boîte>/<message>` la fiche d'un mail, tout le reste l'accueil.
 */
export function screenOf(hash: string): 'audit' | 'search' | 'mail' | 'home' {
  if (hash === '#/audit') return 'audit';
  if (hash === '#/search') return 'search';
  return parseMailHash(hash) ? 'mail' : 'home';
}

/** Navigation minimale par ancre, sans dépendance de routage. */
export function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  const screen = screenOf(hash);
  const mail = parseMailHash(hash);
  return (
    <>
      <nav>
        <a href="#/">Accueil</a> <a href="#/search">Recherche</a>{' '}
        <a href="#/audit">Journal d’audit</a>
      </nav>
      {screen === 'audit' && <AuditPage />}
      {screen === 'search' && <SearchPage />}
      {screen === 'mail' && mail && <MailPage key={hash} {...mail} />}
      {screen === 'home' && <Home />}
    </>
  );
}
