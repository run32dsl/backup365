import { useEffect, useRef, useState } from 'react';
import { AccountsPage } from './AccountsPage.js';
import { ROLE_LABELS } from './accounts.js';
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

/**
 * Entrées de la navigation principale (5 au plus) : seules les entrées livrées apparaissent.
 * Plans de protection s'ajoutera à sa livraison ; Administration (comptes) est réservée aux
 * administrateurs.
 */
export function navEntries(screen: ReturnType<typeof screenFor>, admin: boolean) {
  const entries = [
    { href: '#/', label: 'Tableau de bord', current: screen === 'home' },
    {
      href: '#/search',
      label: 'Rechercher et restaurer',
      current: screen === 'search' || screen === 'mail',
    },
    { href: '#/audit', label: 'Journal d’audit', current: screen === 'audit' },
  ];
  if (admin) {
    entries.push({
      href: '#/comptes',
      label: 'Administration',
      current: screen === 'accounts' || screen === 'forbidden',
    });
  }
  return entries;
}

const goHome = () => {
  window.location.hash = '#/';
};

/** Page des comptes refusée à un opérateur. */
export function ForbiddenView() {
  return (
    <main tabIndex={-1}>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const entries = navEntries(screen, admin);
  // Le menu replié se referme à chaque changement d'écran.
  useEffect(() => {
    setMenuOpen(false);
  }, [hash]);
  return (
    <>
      <a
        className="skip-link"
        href="#/"
        onClick={(e) => {
          // L'ancre porte la navigation : on déplace le focus sans la modifier.
          e.preventDefault();
          document.querySelector<HTMLElement>('main')?.focus();
        }}
      >
        Aller au contenu
      </a>
      <div className="shell">
        <aside className="sidebar">
          <span className="brand">backup365</span>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="sidebar-menu"
            onClick={() => {
              setMenuOpen(!menuOpen);
            }}
          >
            Menu
          </button>
          <div id="sidebar-menu" className="sidebar-collapsible" data-open={menuOpen}>
            <nav aria-label="Navigation principale">
              <ul className="nav-list">
                {entries.map((e) => (
                  <li key={e.href}>
                    <a href={e.href} aria-current={e.current ? 'page' : undefined}>
                      {e.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="sidebar-footer">
              <span>{`${user.username} (${ROLE_LABELS[user.role].toLowerCase()})`}</span>
              <a href="#/password">Mot de passe</a>
              <button type="button" onClick={onLogout}>
                Se déconnecter
              </button>
            </div>
          </div>
        </aside>
        <div>
          {screen === 'audit' && <AuditPage />}
          {screen === 'search' && <SearchPage />}
          {screen === 'accounts' && <AccountsPage />}
          {screen === 'forbidden' && <ForbiddenView />}
          {screen === 'password' && (
            <PasswordPage forced={false} onDone={() => undefined} onCancel={goHome} />
          )}
          {screen === 'mail' && mail && <MailPage key={hash} {...mail} />}
          {screen === 'home' && <Home />}
        </div>
      </div>
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
