import { useEffect, useState } from 'react';
import { AccountsPage } from '../AccountsPage.js';
import { AuditPage } from '../AuditPage.js';
import { RunsPage } from '../activities/RunsPage.js';
import { parseRunsHash } from '../activities/runs.js';
import { ComponentsPage, UnavailableView } from '../ComponentsPage.js';
import { ConsoleFooter } from '../ConsoleFooter.js';
import { demoOf, type HealthState } from '../DemoBanner.js';
import { Home } from '../Home.js';
import { AdminProvider } from '../role.js';
import { PasswordPage } from '../LoginPage.js';
import { MailPage } from '../MailPage.js';
import { OneDrivePage } from '../OneDrivePage.js';
import { parseOneDriveHash } from '../onedrive.js';
import { SharePointPage } from '../SharePointPage.js';
import { parseSharePointHash } from '../sharepoint.js';
import { SearchPage } from '../SearchPage.js';
import { StatusPage } from '../StatusPage.js';
import { parseMailHash, parseSearchHash } from '../mail.js';
import { PlansPage } from '../PlansPage.js';
import { ReportsPage } from '../ReportsPage.js';
import { parsePlansHash } from '../plans.js';
import type { User } from '../session.js';
import { ConsoleView, ForbiddenView } from './ConsoleView.js';
import { navEntries, redirectLegacyHash, screenFor } from './routing.js';

const goHome = () => {
  window.location.hash = '#/';
};

/** Navigation minimale par ancre, sans dépendance de routage. */
export function Console({
  user,
  onLogout,
  health = 'failed',
  flash,
}: {
  user: User;
  onLogout: () => void;
  health?: HealthState;
  flash?: string;
}) {
  const demo = demoOf(health);
  const [hash, setHash] = useState(
    () => redirectLegacyHash(window.location.hash) ?? window.location.hash,
  );
  useEffect(() => {
    const onChange = () => {
      const legacy = redirectLegacyHash(window.location.hash);
      if (legacy !== null) window.history.replaceState(null, '', legacy);
      setHash(legacy ?? window.location.hash);
    };
    onChange();
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
      flash={flash}
      passwordCurrent={screen === 'password'}
      footer={
        <ConsoleFooter
          version={typeof health === 'object' ? health?.version : undefined}
          demo={demo === true}
        />
      }
    >
      <AdminProvider value={admin}>
        {screen === 'components' && <ComponentsPage />}
        {screen === 'unavailable' && <UnavailableView />}
        {screen === 'audit' && <AuditPage />}
        {screen === 'runs' && <RunsPage key={hash} planId={parseRunsHash(hash) ?? ''} />}
        {screen === 'search' && (
          <SearchPage key={hash} mailbox={parseSearchHash(hash) ?? undefined} />
        )}
        {screen === 'plans' && (
          <PlansPage route={parsePlansHash(hash) ?? { page: 'list' }} admin={admin} />
        )}
        {screen === 'accounts' && <AccountsPage />}
        {screen === 'reports' && <ReportsPage />}
        {screen === 'status' && <StatusPage />}
        {screen === 'forbidden' && <ForbiddenView />}
        {screen === 'password' && (
          <PasswordPage forced={false} onDone={() => undefined} onCancel={goHome} />
        )}
        {screen === 'mail' && mail && <MailPage key={hash} {...mail} />}
        {screen === 'sharepoint' && (
          <SharePointPage
            key={hash}
            route={parseSharePointHash(hash) ?? { site: '', scope: null, path: '/' }}
            admin={admin}
          />
        )}
        {screen === 'onedrive' && (
          <OneDrivePage route={parseOneDriveHash(hash) ?? { account: '', path: '/' }} />
        )}
        {screen === 'home' && <Home admin={admin} />}
      </AdminProvider>
    </ConsoleView>
  );
}
