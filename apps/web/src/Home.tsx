import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { dateTimeOf } from './format.js';
import { fetchOverview, type Overview } from './overview.js';
import { PLANS_HASH } from './plans.js';
import { Alert, Button, StatusPill } from './ui/index.js';

/** État du chargement de l'accueil. */
export type OverviewState = Overview | 'loading' | 'error';

const MESSAGES: Record<Overview['state'], string> = {
  operational: '',
  unconfigured: 'Aucune donnée Microsoft 365 n’est encore protégée.',
  failed: 'La dernière exécution a échoué.',
};

/** `il y a 3 h`, `il y a 2 j` : le jour, jamais la semaine ni le mois. */
export function agoLabel(iso: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
  if (hours < 1) return 'il y a moins d’1 h';
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}

/** `3 plans opérationnels sur 4`, `1 plan opérationnel sur 1`. */
export const plansLabel = (operational: number, total: number): string =>
  `${operational} ${operational < 2 ? 'plan opérationnel' : 'plans opérationnels'} sur ${total}`;

const goToPlans = () => {
  window.location.hash = PLANS_HASH;
};

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="overview-card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** Action unique de la carte « Sauvegarde » : « Configurer » (administrateur) ou « Voir l'erreur ». */
function BackupAction({ state, admin }: { state: Overview['state']; admin: boolean }) {
  if (state === 'failed') return <Button onClick={goToPlans}>Voir l’erreur</Button>;
  if (state !== 'unconfigured') return null;
  return admin ? (
    <Button onClick={goToPlans}>Configurer</Button>
  ) : (
    <p>Demandez à un administrateur de la console de configurer la sauvegarde.</p>
  );
}

/** Les trois blocs de l'accueil : état de la sauvegarde, plans, dernière sauvegarde. */
export function OverviewView({
  state,
  admin,
  onRetry,
  now = Date.now(),
}: {
  state: OverviewState;
  admin: boolean;
  onRetry: () => void;
  now?: number;
}) {
  if (state === 'error') {
    return (
      <Alert tone="error" action={<Button onClick={onRetry}>Réessayer</Button>}>
        Impossible d’afficher l’état de la sauvegarde.
      </Alert>
    );
  }
  if (state === 'loading') {
    return (
      <div className="overview" aria-busy="true">
        <Card id="overview-backup" title="Sauvegarde">
          <p>Chargement…</p>
        </Card>
        <Card id="overview-plans" title="Plans">
          <p>Chargement…</p>
        </Card>
        <Card id="overview-last" title="Dernière sauvegarde">
          <p>Chargement…</p>
        </Card>
      </div>
    );
  }
  const { plans } = state;
  const last = state.lastBackupAt;
  const lastDate = last === null ? '' : dateTimeOf(last);
  return (
    <div className="overview">
      <Card id="overview-backup" title="Sauvegarde">
        <div role="status">
          <StatusPill status={state.state} />
        </div>
        {MESSAGES[state.state] && <p>{MESSAGES[state.state]}</p>}
        <BackupAction state={state.state} admin={admin} />
      </Card>
      <Card id="overview-plans" title="Plans">
        {plans.total === 0 ? (
          <p>Aucun plan</p>
        ) : (
          <>
            <p>{plansLabel(plans.operational, plans.total)}</p>
            <a href={PLANS_HASH}>Voir les plans</a>
          </>
        )}
      </Card>
      <Card id="overview-last" title="Dernière sauvegarde">
        {last === null || lastDate === '' ? (
          <p>Aucune sauvegarde</p>
        ) : (
          <p>
            {agoLabel(last, now)} · <time dateTime={last}>{lastDate}</time>
            {state.state === 'failed' && ' (dernière réussie)'}
          </p>
        )}
      </Card>
    </div>
  );
}

/** Page d'accueil : trois informations. La version du serveur est dans le pied de page. */
export function Home({ admin = false }: { admin?: boolean }) {
  const [state, setState] = useState<OverviewState>('loading');
  const load = useCallback(() => {
    setState('loading');
    fetchOverview().then(setState, () => setState('error'));
  }, []);
  useEffect(load, [load]);
  return (
    <main tabIndex={-1}>
      <h1>Tableau de bord</h1>
      <OverviewView state={state} admin={admin} onRetry={load} />
    </main>
  );
}
