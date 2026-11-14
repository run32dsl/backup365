import { useEffect, useState } from 'react';
import { AccountsPage } from './AccountsPage.js';
import { AuditPage } from './AuditPage.js';
import { Home } from './Home.js';
import { CredentialsPage, PasswordPage } from './LoginPage.js';
import { MailPage } from './MailPage.js';
import { SearchPage } from './SearchPage.js';
import { parseMailHash } from './mail.js';
import {
  installSessionFetch,
  loadGate,
  logout,
  onSessionExpired,
  setCsrfToken,
  type Gate,
  type SessionInfo,
  type User,
} from './session.js';

/**
 * Écran demandé par l'ancre de l'URL : `#/audit` le journal, `#/search` la recherche,
 * `#/accounts` les comptes, `#/password` le changement de mot de passe, `#/mail/<boîte>/<message>`
 * la fiche d'un mail, tout le reste l'accueil.
 */
export function screenOf(
  hash: string,
): 'audit' | 'search' | 'accounts' | 'password' | 'mail' | 'home' {
  if (hash === '#/audit') return 'audit';
  if (hash === '#/search') return 'search';
  if (hash === '#/accounts') return 'accounts';
  if (hash === '#/password') return 'password';
  return parseMailHash(hash) ? 'mail' : 'home';
}

/** Navigation minimale par ancre, sans dépendance de routage. */
export function Console({ user, onLogout }: { user: User; onLogout: () => void }) {
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
  const admin = user.role === 'admin';
  const screen = screenOf(hash);
  const mail = parseMailHash(hash);
  return (
    <>
      <nav>
        <a href="#/">Accueil</a> <a href="#/search">Recherche</a>{' '}
        <a href="#/audit">Journal d’audit</a> {admin && <a href="#/accounts">Comptes</a>}{' '}
        <a href="#/password">Mot de passe</a>{' '}
        <button type="button" onClick={onLogout}>
          Se déconnecter ({user.username})
        </button>
      </nav>
      {screen === 'audit' && <AuditPage />}
      {screen === 'search' && <SearchPage />}
      {screen === 'accounts' && admin && <AccountsPage />}
      {screen === 'password' && <PasswordPage forced={false} onDone={() => undefined} />}
      {screen === 'mail' && mail && <MailPage key={hash} {...mail} />}
      {(screen === 'home' || (screen === 'accounts' && !admin)) && <Home />}
    </>
  );
}

/**
 * Porte de l'interface : écran de premier démarrage ou de connexion tant qu'il n'y a pas de
 * session, changement de mot de passe imposé après une réinitialisation, puis la console. Une
 * session expirée (401 d'une requête) ramène à la connexion.
 */
export function App() {
  const [gate, setGate] = useState<Gate>({ status: 'loading' });
  const apply = (next: Gate) => {
    setCsrfToken(next.status === 'ready' ? next.session.csrfToken : null);
    setGate(next);
  };
  const refresh = () => {
    loadGate().then(apply, () => apply({ status: 'error' }));
  };
  useEffect(() => {
    installSessionFetch();
    onSessionExpired(refresh);
    refresh();
    // Au montage seulement : `refresh` ne dépend de rien qui change.
  }, []);

  const open = (session: SessionInfo) => {
    apply({ status: 'ready', session });
  };
  const leave = () => {
    logout().finally(() => {
      window.location.hash = '';
      refresh();
    });
  };

  switch (gate.status) {
    case 'loading':
      return <p role="status">Chargement…</p>;
    case 'error':
      return <p role="alert">Serveur injoignable</p>;
    case 'setup':
    case 'login':
      return <CredentialsPage mode={gate.status} onSession={open} />;
    case 'ready':
      return gate.session.user.mustChangePassword ? (
        <PasswordPage forced onDone={refresh} />
      ) : (
        <Console user={gate.session.user} onLogout={leave} />
      );
  }
}
