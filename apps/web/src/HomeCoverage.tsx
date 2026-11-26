import { nextRunAt, type StatusRow } from '@backup365/core';
import { useState } from 'react';
import { RUNS_HASH, completeRuns, type RunItem } from './activities/runs.js';
import type { HomeData } from './HomeData.js';
import type { PlanItem } from './plans.js';
import { RunAllDialog, launchedLabel } from './RunAllDialog.js';
import { STATUS_HASH } from './routes.js';
import { LatestEventRow, mailOnly, runTypeLabel } from './LatestEventRow.js';
import type { Overview } from './overview.js';
import { Alert, Button, EmptyState } from './ui/index.js';

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
  now,
  onLaunched,
}: {
  plans: PlanItem[] | 'loading' | 'error';
  admin: boolean;
  /** Connexion Microsoft 365 à configurer : aucune échéance annoncée, aucun lancement proposé. */
  connected?: boolean;
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
      {next && !connected && (
        <p>
          Aucune sauvegarde ne partira tant que la connexion Microsoft 365 n’est pas configurée.
        </p>
      )}
      {next && connected && (
        <>
          <p>
            Prochaine sauvegarde dans <strong>{remainingLabel(next, now)}</strong>.
          </p>
          <p className="overview-connection">
            Calculée d’après l’objectif de fraîcheur (RPO) de vos plans.
          </p>
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

/** Les cinq dernières exécutions des plans (`GET /api/runs`), hors journal d'audit. */
export function LatestEvents({
  items,
  plans = [],
  onRetry,
}: {
  items: RunItem[] | 'loading' | 'error';
  /** Plans déjà chargés par l'accueil : donnent la colonne « Type ». */
  plans?: readonly PlanItem[];
  onRetry: () => void;
}) {
  // Une exécution de plan = un événement, même si elle a sauvegardé plusieurs boîtes (#571).
  const events = Array.isArray(items)
    ? completeRuns(items, LATEST_RESULTS).slice(0, LATEST_RUNS)
    : [];
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
        <table className="events-table">
          <caption className="sr-only">Cinq dernières exécutions des plans</caption>
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Type</th>
              <th scope="col">Statut</th>
              <th scope="col">Résumé</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <LatestEventRow
                key={e.id}
                run={e}
                type={runTypeLabel(e, plans)}
                boxes={mailOnly(e, plans)}
              />
            ))}
          </tbody>
        </table>
      )}
      <p>
        <a href={RUNS_HASH}>Tout voir dans Activités</a>
      </p>
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
  now = new Date(),
  onLaunched,
  onRetryEvents,
}: {
  overview: Overview | 'loading' | 'error';
  data: HomeData;
  admin: boolean;
  /** Faux quand la connexion Microsoft 365 est à configurer. */
  connected?: boolean;
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
          onRetry={onRetryEvents}
        />
      )}
    </div>
  );
}
