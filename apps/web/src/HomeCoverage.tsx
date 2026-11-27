import { nextRunAt, type StatusRow } from '@backup365/core';
import { useState } from 'react';
import {
  RUNS_HASH,
  completeRuns,
  mailOnlyTypes,
  type RunEvent,
  type RunItem,
} from './activities/runs.js';
import { runColumns } from './activities/RunsPage.js';
import {
  connectionView,
  interruptedSince,
  latestListed,
  type ConfigurationState,
  type ConnectionView,
} from './ConfigurationBlock.js';
import type { HomeData } from './HomeData.js';
import type { PlanItem } from './plans.js';
import { RunAllDialog, launchedLabel } from './RunAllDialog.js';
import { STATUS_HASH } from './routes.js';
import { STORAGE_NEXT_TEXT } from './StorageBlocked.js';
import type { Overview } from './overview.js';
import { Alert, Button, DataTable, EmptyState } from './ui/index.js';

/** Éléments sauvegardés par service : au moins un instantané, tous types de données confondus. */
export interface Coverage {
  mail: number;
  onedrive: number;
  sharepoint: number;
}

/** Compte les sources distinctes ayant un instantané ; une source sans instantané n'est pas protégée. */
export function coverageOf(rows: readonly StatusRow[]): Coverage {
  const seen: Record<keyof Coverage, Set<string>> = {
    mail: new Set(),
    onedrive: new Set(),
    sharepoint: new Set(),
  };
  for (const row of rows) {
    if (row.state === 'missing') continue;
    if (row.workload === 'mail' || row.workload === 'onedrive' || row.workload === 'sharepoint') {
      seen[row.workload].add(row.sourceId);
    }
  }
  return { mail: seen.mail.size, onedrive: seen.onedrive.size, sharepoint: seen.sharepoint.size };
}

const TILES: { key: keyof Coverage; title: string }[] = [
  { key: 'mail', title: 'Boîtes protégées' },
  { key: 'sharepoint', title: 'Sites protégés' },
  { key: 'onedrive', title: 'OneDrive protégés' },
];

/** Nom accessible d'une tuile : le nombre est dans le nom, avec la destination. */
export const tileName = (title: string, count: number): string =>
  `${title} : ${count}, voir dans Sources`;

/** Tuiles chiffrées de ce qui est protégé ; chaque tuile est un lien vers l'état détaillé. */
export function CoverageTiles({
  coverage,
}: {
  /** `pending` : des plans, aucune sauvegarde terminée ; pas de tuile, la phrase de la carte. */
  coverage: Coverage | 'loading' | 'error' | 'pending';
}) {
  return (
    <section aria-labelledby="home-coverage" aria-busy={coverage === 'loading'}>
      <h2 id="home-coverage">Couverture du tenant</h2>
      {coverage === 'loading' && <p>Chargement…</p>}
      {coverage === 'error' && <p>Les chiffres de couverture ne sont pas disponibles.</p>}
      {coverage === 'pending' && <EmptyState>Aucune sauvegarde n’est encore terminée.</EmptyState>}
      {typeof coverage === 'object' && (
        <ul className="coverage-tiles">
          {TILES.map((t) => (
            <li key={t.key}>
              <a
                className="coverage-tile"
                href={STATUS_HASH}
                aria-label={tileName(t.title, coverage[t.key])}
              >
                <span className="coverage-title">{t.title}</span>
                <strong className="coverage-count">{coverage[t.key]}</strong>
                <span className="coverage-more">Voir dans Sources{'\u00a0'}→</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Plus proche exécution planifiée de tous les plans ; `null` sans plan. */
export function nextBackupAt(plans: readonly PlanItem[], now: Date): Date | null {
  const times = plans.map((p) => nextRunAt(p, now).getTime());
  return times.length === 0 ? null : new Date(Math.min(...times));
}

/** `20 h 42`, `35 min` : durée restante jusqu'à `at`, à la minute. */
export function remainingLabel(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  return h === 0 ? `${minutes} min` : `${h} h ${m}`;
}

/** « Prochaine sauvegarde » et, pour l'administrateur, « Sauvegarder maintenant ». */
export function NextBackup({
  plans,
  admin,
  connected = true,
  interrupted = false,
  storageBlocked = false,
  now,
  onLaunched,
}: {
  plans: PlanItem[] | 'loading' | 'error';
  admin: boolean;
  /** Connexion Microsoft 365 à configurer : aucune échéance annoncée, aucun lancement proposé. */
  connected?: boolean;
  /** Connexion configurée puis interrompue : elle est à rétablir, non à configurer (#604). */
  interrupted?: boolean;
  /** Stockage bloqué : ni échéance ni lancement, quel que soit l'état de la connexion (#612). */
  storageBlocked?: boolean;
  now: Date;
  onLaunched: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const list = Array.isArray(plans) ? plans : [];
  const next = nextBackupAt(list, now);
  const busy = list.some((p) => p.running);
  return (
    <section aria-labelledby="home-next" aria-busy={plans === 'loading'}>
      <h2 id="home-next">Prochaine sauvegarde</h2>
      {plans === 'loading' && <p>Chargement…</p>}
      {plans === 'error' && <p>Les plans ne sont pas disponibles.</p>}
      {Array.isArray(plans) && next === null && <p>Aucun plan de protection n’est configuré.</p>}
      {next && storageBlocked && <p>{STORAGE_NEXT_TEXT}</p>}
      {next && !storageBlocked && !connected && (
        <p>
          Aucune sauvegarde ne partira tant que la connexion Microsoft 365 n’est pas{' '}
          {interrupted ? 'rétablie' : 'configurée'}.
        </p>
      )}
      {next && !storageBlocked && connected && (
        <>
          <p>
            Prochaine sauvegarde dans <strong>{remainingLabel(next, now)}</strong>.
          </p>
          <p className="overview-connection">Calculée d’après la fréquence de vos plans.</p>
          {admin ? (
            <>
              <Button disabled={busy} onClick={() => setOpen(true)}>
                Sauvegarder maintenant
              </Button>
              {busy && <p>Une sauvegarde est en cours.</p>}
            </>
          ) : (
            <p>Le lancement d’une sauvegarde est réservé aux administrateurs.</p>
          )}
        </>
      )}
      <div role="status">{flash}</div>
      <RunAllDialog
        plans={list}
        open={open}
        onClose={() => setOpen(false)}
        onReload={onLaunched}
        onDone={(result) => {
          setOpen(false);
          setFlash(`${launchedLabel(result.launched)}. Motif enregistré au journal d’audit.`);
          onLaunched();
        }}
      />
    </section>
  );
}

/** Nombre d'exécutions de « Derniers événements ». */
export const LATEST_RUNS = 5;

/**
 * Résultats par source demandés au serveur (son maximum) : un lancement en produit un par boîte,
 * il en faut davantage pour réunir cinq exécutions distinctes.
 */
export const LATEST_RESULTS = 20;

/**
 * Lignes de « Derniers événements », de la plus récente à la plus ancienne. Une exécution de plan
 * = un événement, même si elle a sauvegardé plusieurs boîtes (#571). Les cartes de l'accueil en
 * tirent aussi la dernière sauvegarde et la dernière exécution (#608).
 */
export const listedEvents = (items: readonly RunItem[]): RunEvent[] =>
  completeRuns(items, LATEST_RESULTS).slice(0, LATEST_RUNS);

/**
 * Carte « Dernière sauvegarde » d'un administrateur : la ligne « Réussie » la plus récente de
 * « Derniers événements », son heure (celle de la colonne « Heure ») et son plan (#608). Une
 * réussite qui n'a rien copié compte ici comme dans le tableau, et la carte le dit (#640). Sans
 * telle ligne, la réponse du serveur, plus ancienne que toutes les lignes listées.
 */
export function withListedBackup(state: Overview, listed: readonly RunEvent[]): Overview {
  const last = latestListed(listed.filter((e) => e.result === 'success'));
  if (!last) return state;
  return {
    ...state,
    lastBackupAt: last.startedAt,
    lastBackupPlan: last.planName,
    lastBackupNothingNew: (last.itemsSaved ?? 0) === 0,
  };
}

/**
 * Échecs de « Derniers événements » : chaque plan dont la dernière exécution terminée listée est
 * « En échec », de la plus récente à la plus ancienne, à l'heure de la colonne « Heure » (#634).
 */
export function listedFailures(listed: readonly RunEvent[]): { plan: string; at: string }[] {
  const seen = new Set<string>();
  const failures: { plan: string; at: string }[] = [];
  const recentFirst = [...listed].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  for (const e of recentFirst) {
    // Une exécution en cours n'est pas un résultat, comme sur le serveur : on lit la terminée.
    if (e.result === 'running' || seen.has(e.planId)) continue;
    seen.add(e.planId);
    if (e.result === 'failed') failures.push({ plan: e.planName, at: e.startedAt });
  }
  return failures;
}

/**
 * Carte « Sauvegarde » en échec : les échecs listés dans « Derniers événements », avec leur plan
 * et leur heure, pour qu'elle ne cite jamais un échec absent du tableau (#634). Sans échec listé,
 * la réponse du serveur, plus ancienne que toutes les lignes.
 */
export function withListedFailures(state: Overview, listed: readonly RunEvent[]): Overview {
  const failures = listedFailures(listed);
  if (state.state !== 'failed' || failures.length === 0) return state;
  // Le compteur « En échec » ne compte jamais moins de plans que la carte n'en nomme.
  const failed = Math.max(state.plans.failed, failures.length);
  return { ...state, plans: { ...state.plans, failed }, lastFailure: failures[0]!, failures };
}

/**
 * Lecture de l'accueil : les lignes de « Derniers événements », la connexion (celle de la page
 * Plans, datée par ces lignes) et les cartes, qui en reprennent la dernière sauvegarde (#608)
 * et les échecs (#634).
 */
export function homeReading(
  admin: boolean,
  state: Overview | 'loading' | 'error',
  config: ConfigurationState,
  data: Pick<HomeData, 'plans' | 'events'>,
) {
  const listed = Array.isArray(data.events) ? listedEvents(data.events) : [];
  const view: ConnectionView = admin ? connectionView(config, data.plans, listed) : 'connected';
  const overview =
    typeof state === 'object' ? withListedFailures(withListedBackup(state, listed), listed) : state;
  return { listed, view, since: interruptedSince(view), overview };
}

/**
 * Les cinq dernières exécutions des plans (`GET /api/runs`), hors journal d'audit : un extrait
 * d'Activités › Sauvegardes, avec ses colonnes, ses phrases et ses cartes mobiles (#636).
 */
export function LatestEvents({
  items,
  plans = [],
  names = new Map(),
  onRetry,
}: {
  items: RunItem[] | 'loading' | 'error';
  /** Plans déjà chargés par l'accueil : « 5 boîtes » et la cause d'un échec en dépendent. */
  plans?: readonly PlanItem[];
  /** Nom de chaque boîte, lu comme Activités : la source unique d'une exécution est nommée. */
  names?: ReadonlyMap<string, string>;
  onRetry: () => void;
}) {
  const events = Array.isArray(items) ? listedEvents(items) : [];
  const boxPlans = new Set(plans.filter((p) => mailOnlyTypes(p.dataTypes)).map((p) => p.id));
  const planTypes = new Map(plans.map((p) => [p.id, p.dataTypes]));
  return (
    <section aria-labelledby="home-events" aria-busy={items === 'loading'}>
      <h2 id="home-events">Derniers événements</h2>
      {items === 'loading' && <p>Chargement…</p>}
      {items === 'error' && (
        <Alert tone="error" action={<Button onClick={onRetry}>Réessayer</Button>}>
          Impossible d’afficher les derniers événements. Réessayez.
        </Alert>
      )}
      {Array.isArray(items) && items.length === 0 && <p>Aucune exécution pour le moment.</p>}
      {Array.isArray(items) && items.length > 0 && (
        <div className="runs-list">
          <DataTable
            caption="Cinq dernières exécutions des plans"
            hideCaption
            // « Derniers événements » n'est montré qu'à l'administrateur.
            columns={runColumns(names, boxPlans, planTypes, true)}
            rows={events}
            rowKey={(r) => r.id}
          />
        </div>
      )}
      {/* Rien à voir dans Activités tant qu'aucune exécution n'est listée (#600). */}
      {!(Array.isArray(items) && items.length === 0) && (
        <p>
          <a href={RUNS_HASH}>Tout voir dans Activités</a>
        </p>
      )}
    </section>
  );
}

/**
 * Blocs sous les trois cartes : couverture, prochaine sauvegarde, derniers événements. Ils
 * suivent l'état des cartes (`overview`) pour ne jamais les contredire : rien avant la réponse ;
 * sans plan, la seule phrase « Aucun plan… » ; plans sans résultat, ni tuile ni exécution
 * terminée ; connexion Microsoft 365 à configurer, ni échéance ni lancement.
 */
export function HomeCoverage({
  overview,
  data,
  admin,
  connected = true,
  interrupted = false,
  now = new Date(),
  onLaunched,
  onRetryEvents,
}: {
  overview: Overview | 'loading' | 'error';
  data: HomeData;
  admin: boolean;
  /** Faux quand la connexion Microsoft 365 est à configurer ou interrompue. */
  connected?: boolean;
  /** Connexion interrompue (au moins une exécution dans l'historique). */
  interrupted?: boolean;
  now?: Date;
  onLaunched: () => void;
  onRetryEvents: () => void;
}) {
  if (typeof overview !== 'object') return null;
  const nextBackup = (plans: HomeData['plans']) => (
    <NextBackup
      plans={plans}
      admin={admin}
      connected={connected}
      interrupted={interrupted}
      storageBlocked={data.storageBlocked === true}
      now={now}
      onLaunched={onLaunched}
    />
  );
  // Sans plan, la carte « Sauvegarde » porte déjà « Créer un plan » : rien d'autre à dire.
  if (overview.state === 'unconfigured') {
    return <div className="home-coverage">{nextBackup([])}</div>;
  }
  const pending = overview.state === 'pending';
  // Plans sans résultat : seule une première exécution en cours peut être listée.
  const events =
    pending && Array.isArray(data.events)
      ? data.events.filter((r) => r.result === 'running')
      : data.events;
  return (
    <div className="home-coverage">
      <CoverageTiles coverage={pending ? 'pending' : data.coverage} />
      {nextBackup(data.plans)}
      {admin && (
        <LatestEvents
          items={events}
          plans={Array.isArray(data.plans) ? data.plans : []}
          names={data.names}
          onRetry={onRetryEvents}
        />
      )}
    </div>
  );
}
