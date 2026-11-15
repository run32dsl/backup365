import { useEffect, useRef, useState } from 'react';
import { AccountsPage } from './AccountsPage.js';
import { AuditPage } from './AuditPage.js';
import { Home } from './Home.js';
import { CredentialsPage, ErrorView, PasswordPage } from './LoginPage.js';
import { MailPage } from './MailPage.js';
import { SearchPage } from './SearchPage.js';
import { parseMailHash } from './mail.js';
import {
  ADMIN_ONLY,
  LOGIN_HASH,
  installSessionFetch,
  loadGate,
  logout,
  lossMessage,
  requestedPage,
  onSessionExpired,
  setCsrfToken,
  type Gate,
  type SessionInfo,
  type User,
  UNREACHABLE,
} from './session.js';

/**
 * Écran demandé par l'ancre de l'URL : `#/audit` le journal, `#/search` la recherche,
 * `#/comptes` les comptes, `#/password` le changement de mot de passe, `#/mail/<boîte>/<message>`
 * la fiche d'un mail, tout le reste l'accueil.
 */
export function screenOf(
  hash: string,
): 'audit' | 'search' | 'accounts' | 'password' | 'mail' | 'home' {
  if (hash === '#/audit') return 'audit';
  if (hash === '#/search') return 'search';
  if (hash === '#/comptes') return 'accounts';
  if (hash === '#/password') return 'password';
  return parseMailHash(hash) ? 'mail' : 'home';
}

/**
 * Écran affiché pour une ancre et un rôle : un opérateur qui ouvre `#/comptes` reçoit « page
 * réservée » au lieu d'un accueil silencieux.
 */
export function screenFor(hash: string, admin: boolean): ReturnType<typeof screenOf> | 'forbidden' {
  const screen = screenOf(hash);
  return screen === 'accounts' && !admin ? 'forbidden' : screen;
}

const goHome = () => {
  window.location.hash = '#/';
};

/** Page des comptes refusée à un opérateur. */
export function ForbiddenView() {
  return (
    <main>
      <p role="alert">{ADMIN_ONLY}</p>
      <p>
        <a href="#/">Retour à l’accueil</a>
      </p>
    </main>
  );
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
  const screen = screenFor(hash, admin);
  const mail = parseMailHash(hash);
  return (
    <>
      <nav>
        <a href="#/">Accueil</a> <a href="#/search">Recherche</a>{' '}
        <a href="#/audit">Journal d’audit</a> {admin && <a href="#/comptes">Comptes</a>}{' '}
        <a href="#/password">Mot de passe</a>{' '}
        <button type="button" onClick={onLogout}>
          Se déconnecter ({user.username})
        </button>
      </nav>
      {screen === 'audit' && <AuditPage />}
      {screen === 'search' && <SearchPage />}
      {screen === 'accounts' && <AccountsPage />}
      {screen === 'forbidden' && <ForbiddenView />}
      {screen === 'password' && (
        <PasswordPage forced={false} onDone={() => undefined} onCancel={goHome} />
      )}
      {screen === 'mail' && mail && <MailPage key={hash} {...mail} />}
      {screen === 'home' && <Home />}
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
  // Message affiché entre la perte d'une session et la connexion suivante.
  const [notice, setNotice] = useState<string>();
  // Page demandée avant la connexion, rouverte ensuite ; l'ancre vaut `#/connexion` entre-temps.
  const target = useRef<string | null>(null);
  // Incrémenté à chaque refus CSRF : une lecture de session partie avant ne doit pas le défaire.
  const generation = useRef(0);
  const refresh = () => {
    const started = generation.current;
    const ifCurrent = (next: Gate) => {
      if (started === generation.current) apply(next);
    };
    loadGate().then(ifCurrent, () => {
      ifCurrent({ status: 'error' });
    });
  };
  useEffect(() => {
    installSessionFetch();
    onSessionExpired((loss) => {
      setNotice(lossMessage(loss));
      // Un refus CSRF laisse une session valide côté serveur : on revient à la connexion sans
      // la relire, sinon `loadGate` la rouvrirait aussitôt.
      if (loss === 'invalid') {
        generation.current += 1;
        apply({ status: 'login' });
      } else refresh();
    });
    refresh();
    // Au montage seulement : `refresh` ne dépend de rien qui change.
  }, []);

  const unauthenticated = gate.status === 'login' || gate.status === 'setup';
  useEffect(() => {
    if (!unauthenticated) return;
    target.current = requestedPage(window.location.hash) ?? target.current;
    window.location.hash = LOGIN_HASH;
  }, [unauthenticated]);

  const open = (session: SessionInfo) => {
    setNotice(undefined);
    window.location.hash = target.current ?? '#/';
    target.current = null;
    apply({ status: 'ready', session });
  };
  const leave = () => {
    setNotice(undefined);
    logout().finally(() => {
      target.current = null;
      window.location.hash = '';
      // Même si la déconnexion est refusée (jeton CSRF périmé), l'utilisateur voit la connexion.
      generation.current += 1;
      apply({ status: 'login' });
    });
  };

  switch (gate.status) {
    case 'loading':
      return <p role="status">Vérification de la session…</p>;
    case 'error':
      return (
        <ErrorView
          message={UNREACHABLE}
          onRetry={() => {
            setGate({ status: 'loading' });
            refresh();
          }}
        />
      );
    case 'setup':
    case 'login':
      return (
        <CredentialsPage
          mode={gate.status}
          notice={gate.status === 'login' ? notice : undefined}
          onSession={open}
        />
      );
    case 'ready':
      return gate.session.user.mustChangePassword ? (
        <PasswordPage forced onDone={refresh} />
      ) : (
        <Console user={gate.session.user} onLogout={leave} />
      );
  }
}
