import type { ReactNode } from 'react';
import { ROLE_LABELS } from '../accounts.js';
import { AccessDenied } from '../AccessDenied.js';
import type { User } from '../session.js';
import { Alert } from '../ui/index.js';
import type { navEntries } from './routing.js';

/** Identifier that wraps only after « @ » (browsers also break at a hyphen), never inside a word. */
export function AccountId({ username }: { username: string }) {
  const at = username.indexOf('@');
  if (at < 0) return <span>{username}</span>;
  return (
    <span>
      {username.slice(0, at + 1)}
      <wbr />
      {username.slice(at + 1)}
    </span>
  );
}

/** Page des comptes refusée à un opérateur. */
export function ForbiddenView() {
  return (
    <main tabIndex={-1}>
      <h1>Réglages</h1>
      <AccessDenied title="Accès réservé" href="#/" exit="Retour à l’accueil">
        Cette page est réservée aux administrateurs. Demandez à un administrateur de la console de
        faire cette action.
      </AccessDenied>
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
  flash,
  passwordCurrent = false,
  children,
}: {
  /** La page « Mot de passe » (lien du pied de barre) est ouverte. */
  passwordCurrent?: boolean;
  user: User;
  entries: ReturnType<typeof navEntries>;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onLogout: () => void;
  footer?: ReactNode;
  /** Confirmation passagère, annoncée aux lecteurs d'écran (région `status`). */
  flash?: string;
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
                      <span className="nav-icon" aria-hidden="true">
                        {e.icon}
                      </span>
                      <span className="nav-label">{e.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="sidebar-footer">
              <span className="sidebar-account">
                <AccountId username={user.username} />
                <span className="sidebar-role">{`(${ROLE_LABELS[user.role].toLowerCase()})`}</span>
              </span>
              {!user.oidc && (
                <a href="#/password" aria-current={passwordCurrent ? 'page' : undefined}>
                  Mot de passe
                </a>
              )}
              <button type="button" onClick={onLogout}>
                Se déconnecter
              </button>
            </div>
          </div>
        </aside>
        <div className="content">
          <div role="status">{flash && <Alert tone="success">{flash}</Alert>}</div>
          {children}
          {footer}
        </div>
      </div>
    </>
  );
}
