import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { connectionLine, useConfiguration } from './ConfigurationBlock.js';
import { dateTimeOf, quoted, workloadLabel } from './format.js';
import { HomeCoverage, homeReading } from './HomeCoverage.js';
import { useHomeData } from './HomeData.js';
import { ReportFailureNotice } from './reports/ReportFailureNotice.js';
import { HomeAlerts } from './StorageBlocked.js';
import { goToStorage } from './status/StorageCheck.js';
import { fetchOverview, type Overview } from './overview.js';
import {
  FAILED_PLANS_HASH,
  MESSAGES as PLAN_MESSAGES,
  NEW_PLAN_HASH,
  PLANS_HASH,
} from './plans.js';
import { Alert, Button, StatusPill } from './ui/index.js';

/** État du chargement de l'accueil. */
export type OverviewState = Overview | 'loading' | 'error';

const MESSAGES: Record<Overview['state'], string> = {
  operational: '',
  unconfigured: 'Aucune donnée Microsoft 365 n’est encore protégée.',
  pending: 'Aucune sauvegarde n’est encore terminée.',
  failed: 'Un plan est en échec.',
};

/**
 * Phrase de la carte « Sauvegarde » ; en échec, elle nomme le plan et l'heure de l'échec (comme la
 * page Plans), ou chacun des plans en échec listés dans « Derniers événements » (#634).
 */
export function backupMessage(state: Overview): string {
  const failure = state.lastFailure;
  const failures = state.failures ?? [];
  // Le compteur de la carte « Plans » compte aussi les plans dont l'échec n'est pas listé.
  const total = Math.max(state.plans.failed, failures.length);
  if (state.state === 'failed' && failures.length > 0 && total > 1) {
    const named = failures
      .map((f) => {
        const at = dateTimeOf(f.at);
        return `${quoted(f.plan)}${at && ` le ${at} UTC`}`;
      })
      .join(', ');
    return failures.length < total
      ? `${total} plans en échec, dont ${named}.`
      : `${total} plans en échec : ${named}.`;
  }
  if (state.state === 'failed' && failure) {
    const at = dateTimeOf(failure.at);
    return `Échec de ${quoted(failure.plan)}${at && ` le ${at} UTC`}.`;
  }
  return MESSAGES[state.state];
}

/** Phrase du retard : une sauvegarde est nommée, plusieurs sont résumées par service. */
export function lateMessage(late: Overview['lateBackups']): string {
  const [first] = late;
  if (!first) return '';
  if (late.length === 1) {
    const at = dateTimeOf(first.lastSnapshotAt);
    return `1 sauvegarde en retard : ${workloadLabel(first.service)}, ${first.name}${at && `, dernière réussite le ${at} UTC`}.`;
  }
  const services = (['mail', 'onedrive', 'sharepoint'] as const)
    .filter((s) => late.some((l) => l.service === s))
    .map(workloadLabel);
  return `${late.length} sauvegardes en retard (${services.join(', ')}).`;
}

/** `il y a 3 h`, `il y a 2 j` : le jour, jamais la semaine ni le mois. */
export function agoLabel(iso: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
  if (hours < 1) return 'il y a moins d’1 h';
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}

/** `3 plans à jour sur 4`, `1 plan à jour sur 1` : le mot de la pastille « À jour » de la liste. */
export const plansLabel = (operational: number, total: number): string =>
  `${operational} ${operational < 2 ? 'plan' : 'plans'} à jour sur ${total}`;

/** Plans sans aucun résultat : `1 plan, en attente de sa première sauvegarde` (#600). */
export const waitingLabel = (total: number): string =>
  total < 2
    ? `${total} plan, en attente de sa première sauvegarde`
    : `${total} plans, en attente de leur première sauvegarde`;

/** « Créer un plan » : directement l'assistant, sans passer par la liste vide. */
const goToNewPlan = () => {
  window.location.hash = NEW_PLAN_HASH;
};

/** « Voir l'erreur » : la liste des plans, réduite à ceux en échec, avec la cause. */
const goToFailedPlans = () => {
  window.location.hash = FAILED_PLANS_HASH;
};

/** « Voir les sources » : la page Sources, où chaque sauvegarde en retard est listée. */
const goToSources = () => {
  window.location.hash = '#/sources';
};

/** « Voir les plans » : la liste des plans, sans filtre. */
const goToPlans = () => {
  window.location.hash = PLANS_HASH;
};

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="overview-card" aria-labelledby={id}>
      <h2 id={id} tabIndex={id === 'overview-backup' ? -1 : undefined}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Plans par état, du plus grave au moins grave, avec les pastilles et les mots de la liste des
 * plans ; une pastille par état non nul, rien quand aucun plan n'est dans ces états.
 */
function PlanStates({ plans }: { plans: Overview['plans'] }) {
  const states = [
    { status: 'failed', count: plans.failed },
    { status: 'late', count: plans.late },
    { status: 'running', count: plans.running, label: PLAN_MESSAGES.running },
    { status: 'pending', count: plans.queued, label: PLAN_MESSAGES.queued },
    // Sans exécution terminée : ni en retard ni à jour, en attente (#600).
    { status: 'pending', count: plans.waiting, label: 'En attente' },
  ] as const;
  const shown = states.filter((s) => s.count > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="plan-counts">
      {shown.map((s) => (
        <li key={'label' in s ? s.label : s.status}>
          <StatusPill status={s.status} label={'label' in s ? s.label : undefined} />{' '}
          <strong>{s.count}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Action unique de la carte « Sauvegarde » : « Créer un plan » (administrateur) ou « Voir l'erreur ». */
export function BackupAction({
  state,
  admin,
  late = false,
  storageBlocked = false,
  interrupted = false,
}: {
  state: Overview['state'];
  admin: boolean;
  /** Au moins une sauvegarde en retard : « Voir les sources », en contour sous l'action principale. */
  late?: boolean;
  /** Stockage bloqué : « Voir le stockage », seule action (#616). */
  storageBlocked?: boolean;
  /** Connexion Microsoft 365 interrompue : « Voir les sources », seule action (#622). */
  interrupted?: boolean;
}) {
  // Ouvre déjà État des sources : pas de « Voir les sources » en plus (#616).
  if (storageBlocked) return <Button onClick={() => goToStorage()}>Voir le stockage</Button>;
  // La conduite à tenir est dans le bandeau sous le `h1` : aucun bouton n'y renvoie (#622).
  if (interrupted) return <Button onClick={goToSources}>Voir les sources</Button>;
  const sources = late && (
    <Button variant="secondary" onClick={goToSources}>
      Voir les sources
    </Button>
  );
  if (state === 'failed')
    return (
      <>
        <Button onClick={goToFailedPlans}>Voir l’erreur</Button>
        {sources}
      </>
    );
  if (state !== 'unconfigured') return sources || null;
  return admin ? (
    <Button onClick={goToNewPlan}>Créer un plan</Button>
  ) : (
    <p>Demandez à un administrateur de la console de configurer la sauvegarde.</p>
  );
}

/** Action de la carte « Plans » : en contour, pour ne pas concurrencer « Voir l'erreur ». */
export function PlansAction() {
  return (
    <Button variant="secondary" onClick={goToPlans}>
      Voir les plans
    </Button>
  );
}

/** Les trois blocs de l'accueil : état de la sauvegarde, plans, dernière sauvegarde. */
export function OverviewView({
  state,
  admin,
  onRetry,
  now = Date.now(),
  connection = null,
  interruptedSince = null,
  storageBlocked = false,
}: {
  state: OverviewState;
  admin: boolean;
  /** Ligne secondaire de la carte « Sauvegarde » (administrateur, connexion configurée). */
  connection?: string | null;
  /** Connexion Microsoft 365 interrompue : pastille « Interrompue », dite sous le `h1` (#622). */
  interruptedSince?: string | null;
  /** Stockage bloqué : plus aucune sauvegarde ne peut aboutir, comme sans connexion (#612). */
  storageBlocked?: boolean;
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
  const isLate = state.lateBackups.length > 0;
  const last = state.lastBackupAt;
  const lastDate = last === null ? '' : dateTimeOf(last);
  return (
    <div className="overview">
      <Card id="overview-backup" title="Sauvegarde">
        <div role="status">
          {storageBlocked || interruptedSince !== null ? (
            <StatusPill status="failed" label="Interrompue" />
          ) : (
            <StatusPill status={isLate && state.state === 'operational' ? 'late' : state.state} />
          )}
        </div>
        {/* Stockage et connexion sont dits sous le `h1` : ici, échecs et retards (#616, #622). */}
        {backupMessage(state) && <p>{backupMessage(state)}</p>}
        {isLate && <p>{lateMessage(state.lateBackups)}</p>}
        {connection && <p className="overview-connection">{connection}</p>}
        <BackupAction
          state={state.state}
          admin={admin}
          late={isLate}
          storageBlocked={storageBlocked}
          interrupted={interruptedSince !== null}
        />
      </Card>
      <Card id="overview-plans" title="Plans">
        {plans.total === 0 ? (
          <p>Aucun plan pour l’instant.</p>
        ) : plans.waiting === plans.total ? (
          // Aucun plan n'a de résultat : la pastille de la carte « Sauvegarde », pas de retard (#600).
          <>
            <div>
              <StatusPill status="pending" />
            </div>
            <p>{waitingLabel(plans.total)}</p>
            <PlanStates plans={{ ...plans, waiting: 0 }} />
            <PlansAction />
          </>
        ) : (
          <>
            <p>{plansLabel(plans.operational, plans.total)}</p>
            <PlanStates plans={plans} />
            <PlansAction />
          </>
        )}
      </Card>
      <Card id="overview-last" title="Dernière sauvegarde">
        {last === null || lastDate === '' ? (
          // Même phrase que la carte « Sauvegarde » (#600) ; un échec, lui, a déjà terminé une exécution.
          <p>
            {state.state === 'failed'
              ? 'Aucune sauvegarde réussie pour l’instant.'
              : MESSAGES.pending}
          </p>
        ) : (
          <>
            <p>
              <time dateTime={last}>{`${lastDate} UTC`}</time>{' '}
              <span className="overview-ago">· {agoLabel(last, now)}</span>
            </p>
            {state.lastBackupPlan && <p>Plan : {state.lastBackupPlan}</p>}
          </>
        )}
      </Card>
    </div>
  );
}

/** Texte annoncé après « Réessayer » ; vide pour l'erreur (l'alerte s'annonce seule). */
export function announcementOf(state: OverviewState): string {
  if (state === 'loading') return 'Chargement de l’état de la sauvegarde…';
  return state === 'error' ? '' : 'État de la sauvegarde mis à jour.';
}

/** Le bouton « Réessayer » est démonté : le focus va au titre de la carte « Sauvegarde », sinon au `h1`. */
export function focusAfterRetry(
  doc: { querySelector: (selector: string) => { focus: () => void } | null } = document,
): void {
  (doc.querySelector('#overview-backup') ?? doc.querySelector('h1'))?.focus();
}

/** Lance la lecture et publie `loading` puis le résultat, ou `error` ; ne rejette jamais. */
export function loadOverview(
  publish: (state: OverviewState) => void,
  fetcher: () => Promise<Overview> = fetchOverview,
): Promise<void> {
  publish('loading');
  return fetcher().then(publish, () => publish('error'));
}

/** Page d'accueil : trois informations. La version du serveur est dans le pied de page. */
export function Home({ admin = false }: { admin?: boolean }) {
  const [state, setState] = useState<OverviewState>('loading');
  const config = useConfiguration(admin);
  // Une seule lecture pour toute la page : les cartes et les blocs du bas se rechargent ensemble.
  const data = useHomeData(admin);
  const loadData = data.load;
  const retried = useRef(false);
  // Connexion et dernière sauvegarde lues sur les lignes de « Derniers événements » (#604, #608).
  const { listed, view, since, overview } = homeReading(admin, state, config, data);
  const blocked = admin && data.storageBlocked === true;
  const load = useCallback(() => {
    void loadOverview(setState);
    loadData();
  }, [loadData]);
  // Après « Sauvegarder maintenant » : tout se relit, sans repasser par « Chargement… ».
  const refresh = useCallback(() => {
    fetchOverview().then(setState, () => setState('error'));
    loadData();
  }, [loadData]);
  const retry = useCallback(() => {
    retried.current = true;
    load();
  }, [load]);
  useEffect(load, [load]);
  // Après « Réessayer » le bouton disparaît : sans cela le focus tomberait sur `body`.
  useEffect(() => {
    if (retried.current) focusAfterRetry();
  }, [state]);
  return (
    <main tabIndex={-1}>
      <h1 tabIndex={-1}>Accueil</h1>
      <div role="status" className="sr-only">
        {retried.current ? announcementOf(state) : ''}
      </div>
      {admin && <HomeAlerts blocked={blocked} config={config} plans={data.plans} listed={listed} />}
      <OverviewView
        state={overview}
        admin={admin}
        onRetry={retry}
        connection={admin ? connectionLine(config) : null}
        interruptedSince={since}
        storageBlocked={blocked}
      />
      {/* Problème secondaire : sous les cartes, le haut de l'Accueil reste à l'état des sauvegardes. */}
      <ReportFailureNotice enabled={admin} />
      <HomeCoverage
        // Connexion encore inconnue : rien, plutôt qu'une échéance peut-être fausse.
        overview={admin && view === 'loading' ? 'loading' : state}
        data={data}
        admin={admin}
        connected={typeof config !== 'object' || config.microsoft.connected}
        interrupted={since !== null}
        onLaunched={refresh}
        onRetryEvents={data.loadEvents}
      />
    </main>
  );
}
