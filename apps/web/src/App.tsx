import { useEffect, useRef, useState } from 'react';
import { Console } from './app/Console.js';
import { ConsoleFooter } from './ConsoleFooter.js';
import { DemoBanner, demoOf, useHealth, type HealthState } from './DemoBanner.js';
import { CredentialsPage, ErrorView, PASSWORD_CHANGED, PasswordPage } from './LoginPage.js';
import {
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
  UNREACHABLE,
} from './session.js';

// Le gabarit et le routage vivent sous `app/` ; ils restent importables d'ici pour les tests.
export { Console } from './app/Console.js';
export { ConsoleView, ForbiddenView, closeMenuOnEscape, skipToContent } from './app/ConsoleView.js';
export {
  MAX_ADMIN_NAV_ENTRIES,
  navEntries,
  redirectLegacyHash,
  screenFor,
  screenOf,
  type NavEntry,
} from './app/routing.js';

/** Durée d'affichage de la confirmation de changement de mot de passe. */
const FLASH_MS = 8000;

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
    // Une confirmation ne survit pas à une session perdue.
    if (next.status !== 'ready') setFlash(undefined);
    setGate(next);
  };
  // Message affiché entre la perte d'une session et la connexion suivante.
  // Retour refusé de Microsoft (`?oidc_error=`) : lu une fois, puis retiré de l'adresse.
  const [refusal, setRefusal] = useState<string | undefined>(() => {
    const message = oidcErrorMessage(window.location.search);
    if (message) window.history.replaceState(null, '', window.location.pathname);
    return message;
  });
  const [notice, setNotice] = useState<string | undefined>();
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

  // Confirmation du changement de mot de passe : lisible quelques secondes, puis retirée.
  const [flash, setFlash] = useState<string>();
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => {
      setFlash(undefined);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flash]);
  const passwordChanged = () => {
    setFlash(PASSWORD_CHANGED);
  };

  const open = (session: SessionInfo) => {
    setNotice(undefined);
    setRefusal(undefined);
    window.location.hash = target.current ?? '#/';
    target.current = null;
    apply({ status: 'ready', session });
  };
  const leave = () => {
    setNotice(undefined);
    setRefusal(undefined);
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
        <div className="login-page">
          <CredentialsPage
            mode={gate.status}
            notice={gate.status === 'login' ? notice : undefined}
            refusal={gate.status === 'login' ? refusal : undefined}
            onSession={open}
          />
          <ConsoleFooter
            version={typeof health === 'object' ? health?.version : undefined}
            demo={false}
          />
        </div>
      );
    case 'ready':
      return gate.session.user.mustChangePassword ? (
        <div className="login-page">
          <PasswordPage
            forced
            onDone={() => {
              passwordChanged();
              window.location.hash = '#/';
              refresh();
            }}
          />
          <ConsoleFooter
            version={typeof health === 'object' ? health?.version : undefined}
            demo={false}
          />
        </div>
      ) : (
        <Console user={gate.session.user} onLogout={leave} health={health} flash={flash} />
      );
  }
}
