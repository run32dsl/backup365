import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccountsPage } from './AccountsPage.js';
import { ROLE_LABELS } from './accounts.js';
import { AuditPage } from './AuditPage.js';
import { ComponentsPage, UnavailableView } from './ComponentsPage.js';
import { ConsoleFooter } from './ConsoleFooter.js';
import { DemoBanner, demoOf, useHealth, type HealthState } from './DemoBanner.js';
import { Home } from './Home.js';
import { CredentialsPage, ErrorView, PasswordPage } from './LoginPage.js';
import { MailPage } from './MailPage.js';
import { OneDrivePage } from './OneDrivePage.js';
import { parseOneDriveHash } from './onedrive.js';
import { SharePointPage } from './SharePointPage.js';
import { parseSharePointHash } from './sharepoint.js';
import { SearchPage } from './SearchPage.js';
import { parseMailHash } from './mail.js';
import { PlansPage } from './PlansPage.js';
import { parsePlansHash } from './plans.js';
import { COMPONENTS_HASH } from './routes.js';
import { Alert } from './ui/index.js';
import {
  ADMIN_ONLY,
  LOGIN_HASH,
  installSessionFetch,
  loadGate,
  logout,
  lossMessage,
  oidcErrorMessage,
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
 * la fiche d'un mail, `#/onedrive/<compte>/<chemin>` la restauration OneDrive,
 * `#/sharepoint/<site>/<granularité>` la restauration SharePoint, tout le reste
 * l'accueil.
 */
export function screenOf(
  hash: string,
):
  | 'audit'
  | 'search'
  | 'accounts'
  | 'plans'
  | 'password'
  | 'components'
  | 'mail'
  | 'onedrive'
  | 'sharepoint'
  | 'home' {
  if (parsePlansHash(hash)) return 'plans';
  if (parseOneDriveHash(hash)) return 'onedrive';
  if (parseSharePointHash(hash)) return 'sharepoint';
  if (hash === '#/audit') return 'audit';
  if (hash === '#/search') return 'search';
  if (hash === '#/comptes') return 'accounts';
  if (hash === '#/password') return 'password';
  if (hash === COMPONENTS_HASH) return 'components';
  return parseMailHash(hash) ? 'mail' : 'home';
}

/**
 * Écran affiché pour une ancre et un rôle : un opérateur qui ouvre `#/comptes` reçoit « page
 * réservée » au lieu d'un accueil silencieux.
 */
export function screenFor(
  hash: string,
  admin: boolean,
  demo: boolean | null = false,
): ReturnType<typeof screenOf> | 'forbidden' | 'unavailable' | 'pending' {
  const screen = screenOf(hash);
  // `null` : le serveur n'a pas encore dit s'il est en démo ; rien n'est affiché plutôt qu'un avis faux.
  if (screen === 'components') return demo === null ? 'pending' : demo ? screen : 'unavailable';
  return screen === 'accounts' && !admin ? 'forbidden' : screen;
}

/**
 * Entrées de la navigation principale (7 au plus) : seules les entrées livrées apparaissent.
 * Administration (comptes) est réservée aux administrateurs.
 */
export function navEntries(screen: ReturnType<typeof screenFor>, admin: boolean) {
  const entries = [
    { href: '#/', label: 'Tableau de bord', current: screen === 'home' },
    {
      href: '#/search',
      label: 'Rechercher et restaurer',
      current: screen === 'search' || screen === 'mail',
    },
    { href: '#/onedrive', label: 'OneDrive', current: screen === 'onedrive' },
    { href: '#/sharepoint', label: 'SharePoint', current: screen === 'sharepoint' },
    { href: '#/plans', label: 'Plans de protection', current: screen === 'plans' },
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
      <Alert tone="error">{ADMIN_ONLY}</Alert>
      <p>
        <a href="#/">Retour à l’accueil</a>
      </p>
    </main>
  );
}

/**
 * Lien d'évitement : donne le focus au contenu. L'ancre porte la navigation, on ne la modifie
 * donc pas.
 */
export function skipToContent(
  e: { preventDefault: () => void },
  doc: { querySelector: (selector: string) => { focus: () => void } | null } = document,
): void {
  e.preventDefault();
  doc.querySelector('main')?.focus();
}

/**
 * Échap referme le menu ouvert et rend le focus au bouton « Menu » : sans cela le focus
 * resterait sur un lien que la fermeture vient de masquer.
 */
export function closeMenuOnEscape(
  e: {
    key: string;
    currentTarget: { querySelector: (selector: string) => { focus: () => void } | null };
  },
  open: boolean,
  close: () => void,
): void {
  if (e.key !== 'Escape' || !open) return;
  close();
  e.currentTarget.querySelector('.menu-toggle')?.focus();
}

/**
 * Gabarit de la console, sans état : lien d'évitement, barre latérale, puis l'écran. L'ordre
 * du document est l'ordre de tabulation. Le clavier ne repose que sur des éléments natifs
 * (`<a href>`, `<button>`), ce qui rend chaque geste vérifiable sans navigateur.
 */
export function ConsoleView({
  user,
  entries,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onLogout,
  footer,
  children,
}: {
  user: User;
  entries: ReturnType<typeof navEntries>;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onLogout: () => void;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <a
        className="skip-link"
        href="#/"
        onClick={(e) => {
          skipToContent(e);
        }}
      >
        Aller au contenu
      </a>
      <div className="shell">
        <aside
          className="sidebar"
          onKeyDown={(e) => {
            closeMenuOnEscape(e, menuOpen, onCloseMenu);
          }}
        >
          <span className="brand">backup365</span>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="sidebar-menu"
            onClick={onToggleMenu}
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
              {!user.oidc && <a href="#/password">Mot de passe</a>}
              <button type="button" onClick={onLogout}>
                Se déconnecter
              </button>
            </div>
          </div>
        </aside>
        <div className="content">
          {children}
          {footer}
        </div>
      </div>
    </>
  );
}

/** Navigation minimale par ancre, sans dépendance de routage. */
export function Console({
  user,
  onLogout,
  health = 'failed',
}: {
  user: User;
  onLogout: () => void;
  health?: HealthState;
}) {
  const demo = demoOf(health);
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
  const screen = screenFor(hash, admin, demo);
  const mail = parseMailHash(hash);
  const [menuOpen, setMenuOpen] = useState(false);
  // Le menu replié se referme à chaque changement d'écran.
  useEffect(() => {
    setMenuOpen(false);
  }, [hash]);
  return (
    <ConsoleView
      user={user}
      entries={navEntries(screen, admin)}
      menuOpen={menuOpen}
      onToggleMenu={() => {
        setMenuOpen((open) => !open);
      }}
      onCloseMenu={() => {
        setMenuOpen(false);
      }}
      onLogout={onLogout}
      footer={
        <ConsoleFooter
          version={typeof health === 'object' ? health?.version : undefined}
          demo={demo === true}
        />
      }
    >
      {screen === 'components' && <ComponentsPage />}
      {screen === 'unavailable' && <UnavailableView />}
      {screen === 'audit' && <AuditPage />}
      {screen === 'search' && <SearchPage />}
      {screen === 'plans' && (
        <PlansPage route={parsePlansHash(hash) ?? { page: 'list' }} admin={admin} />
      )}
      {screen === 'accounts' && <AccountsPage />}
      {screen === 'forbidden' && <ForbiddenView />}
      {screen === 'password' && (
        <PasswordPage forced={false} onDone={() => undefined} onCancel={goHome} />
      )}
      {screen === 'mail' && mail && <MailPage key={hash} {...mail} />}
      {screen === 'sharepoint' && (
        <SharePointPage
          key={hash}
          route={parseSharePointHash(hash) ?? { site: '', scope: null }}
          admin={admin}
        />
      )}
      {screen === 'onedrive' && (
        <OneDrivePage route={parseOneDriveHash(hash) ?? { account: '', path: '/' }} />
      )}
      {screen === 'home' && <Home />}
    </ConsoleView>
  );
}

/**
 * Porte de l'interface : écran de premier démarrage ou de connexion tant qu'il n'y a pas de
 * session, changement de mot de passe imposé après une réinitialisation, puis la console. Une
 * session expirée (401 d'une requête) ramène à la connexion.
 */
export function App() {
  const health = useHealth();
  return (
    <>
      <DemoBanner demo={demoOf(health) === true} />
      <AppGate health={health} />
    </>
  );
}

function AppGate({ health }: { health: HealthState }) {
  const [gate, setGate] = useState<Gate>({ status: 'loading' });
  const apply = (next: Gate) => {
    setCsrfToken(next.status === 'ready' ? next.session.csrfToken : null);
    setGate(next);
  };
  // Message affiché entre la perte d'une session et la connexion suivante.
  // Retour refusé de Microsoft (`?oidc_error=`) : lu une fois, puis retiré de l'adresse.
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | undefined>(() => {
    const message = oidcErrorMessage(window.location.search);
    if (message) window.history.replaceState(null, '', window.location.pathname);
    return message ? { text: message, tone: 'error' } : undefined;
  });
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
      setNotice({ text: lossMessage(loss), tone: 'info' });
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
          notice={gate.status === 'login' ? notice?.text : undefined}
          noticeTone={notice?.tone}
          onSession={open}
        />
      );
    case 'ready':
      return gate.session.user.mustChangePassword ? (
        <PasswordPage forced onDone={refresh} />
      ) : (
        <Console user={gate.session.user} onLogout={leave} health={health} />
      );
  }
}
