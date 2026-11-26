import { DATA_TYPES, nextRunAt, type StatusReport, type StatusRow } from '@backup365/core';
import { useCallback, useEffect, useState } from 'react';
import {
  RESULT_VIEW,
  RUNS_HASH,
  causeOf,
  countLabel,
  durationLabel,
  fetchRuns,
  volumeLabel,
  type RunItem,
} from './activities/runs.js';
import { NBSP, dateTimeOf, plural, quoted } from './format.js';
import { fetchPlans, runPlan, runReasonError, type PlanItem } from './plans.js';
import { DATA_TYPE_LABELS } from './plans/model.js';
import { REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import { STATUS_HASH } from './routes.js';
import { fetchStatus } from './status.js';
import { Alert, Button, Dialog, StatusPill } from './ui/index.js';

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
export function CoverageTiles({ coverage }: { coverage: Coverage | 'loading' | 'error' }) {
  return (
    <section aria-labelledby="home-coverage" aria-busy={coverage === 'loading'}>
      <h2 id="home-coverage">Couverture du tenant</h2>
      {coverage === 'loading' && <p>Chargement…</p>}
      {coverage === 'error' && <p>Les chiffres de couverture ne sont pas disponibles.</p>}
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
                <span className="coverage-more">Voir dans Sources →</span>
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

/** `1 sauvegarde lancée`, `3 sauvegardes lancées`. */
export const launchedLabel = (n: number): string =>
  plural(n, 'sauvegarde lancée', 'sauvegardes lancées');

/** Résultat du lancement de tous les plans : démarrés ou mis en file, et échecs (message du serveur). */
export interface RunAllResult {
  launched: number;
  failures: string[];
}

/** Lance chaque plan l'un après l'autre avec le même motif (`POST /api/plans/:id/run`). */
export async function runAll(
  plans: readonly PlanItem[],
  reason: string,
  run: typeof runPlan = runPlan,
): Promise<RunAllResult> {
  const result: RunAllResult = { launched: 0, failures: [] };
  for (const plan of plans) {
    const outcome = await run(plan.id, reason);
    if (outcome.ok) result.launched += 1;
    else result.failures.push(`${quoted(plan.name)} : ${outcome.message}`);
  }
  return result;
}

function RunAllDialog({
  plans,
  open,
  onClose,
  onDone,
  onReload,
}: {
  plans: readonly PlanItem[];
  open: boolean;
  onClose: () => void;
  onDone: (result: RunAllResult) => void;
  /** Échec partiel : le dialogue reste ouvert avec les échecs, la liste se recharge. */
  onReload: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
      setFailures([]);
      setBusy(false);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      title="Sauvegarder maintenant"
      onClose={() => {
        // Fermer ne coupe pas les lancements en cours : on attend leur fin.
        if (!busy) onClose();
      }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          const missing = runReasonError(reason);
          setError(missing);
          if (missing !== undefined) return;
          setBusy(true);
          setFailures([]);
          void runAll(plans, reason).then((result) => {
            setBusy(false);
            if (result.failures.length === 0) onDone(result);
            else {
              setFailures(result.failures);
              if (result.launched > 0) onReload();
            }
          });
        }}
      >
        <ReasonField
          of="du lancement"
          placeholder={REASON_EXAMPLES.run}
          value={reason}
          error={error}
          onChange={setReason}
        />
        <p>
          {plural(plans.length, 'plan sera lancé', 'plans seront lancés')} maintenant. Le motif et
          le lancement sont inscrits au journal d’audit.
        </p>
        {failures.length === 1 && <Alert tone="error">{failures[0]}</Alert>}
        {failures.length > 1 && (
          <Alert tone="error">
            <ul className="alert-steps">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="button-row dialog-actions">
          <Button variant="secondary" data-safe disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" busy={busy}>
            Lancer la sauvegarde
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** « Prochaine sauvegarde » et, pour l'administrateur, « Sauvegarder maintenant ». */
export function NextBackup({
  plans,
  admin,
  now,
  onLaunched,
}: {
  plans: PlanItem[] | 'loading' | 'error';
  admin: boolean;
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
      {next && (
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

/** Colonne « Type » : ce que le plan protège (« Messagerie, OneDrive ») ; `Sauvegarde` à défaut. */
export function runTypeLabel(run: RunItem, plans: readonly PlanItem[]): string {
  const plan = plans.find((p) => p.id === run.planId);
  const types = DATA_TYPES.filter((t) => plan?.dataTypes?.includes(t));
  return types.length === 0 ? 'Sauvegarde' : types.map((t) => DATA_TYPE_LABELS[t]).join(', ');
}

/** Colonne « Résumé » : le plan puis les compteurs connus, ou la cause d'un échec. */
export function runSummary(run: RunItem): string {
  const plan = quoted(run.planName);
  if (run.result === 'running') return `${plan} · sauvegarde en cours`;
  const cause = causeOf(run);
  if (cause) return `${plan} · cause${NBSP}: ${cause.cause}`;
  const parts = [
    run.itemsSaved === null
      ? ''
      : `${countLabel(run.itemsSaved)} ${run.itemsSaved < 2 ? 'élément copié' : 'éléments copiés'}`,
    volumeLabel(run.sourceBytes) ?? '',
    run.durationMs === null ? '' : durationLabel(run.durationMs),
  ];
  return [plan, ...parts.filter(Boolean)].join(' · ');
}

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
            {items.map((r) => (
              <tr key={r.id}>
                <td data-label="Heure">
                  <time dateTime={r.startedAt}>{`${dateTimeOf(r.startedAt) || '—'} UTC`}</time>
                </td>
                <td data-label="Type">{runTypeLabel(r, plans)}</td>
                <td data-label="Statut">
                  <StatusPill
                    status={RESULT_VIEW[r.result].status}
                    label={RESULT_VIEW[r.result].label}
                  />
                </td>
                <td data-label="Résumé">{runSummary(r)}</td>
              </tr>
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

/** Bloc de l'accueil sous les trois cartes : couverture, prochaine sauvegarde, derniers événements. */
export function HomeCoverage({ admin }: { admin: boolean }) {
  const [coverage, setCoverage] = useState<Coverage | 'loading' | 'error'>('loading');
  const [plans, setPlans] = useState<PlanItem[] | 'loading' | 'error'>('loading');
  const [events, setEvents] = useState<RunItem[] | 'loading' | 'error'>('loading');
  const loadPlans = useCallback(() => {
    fetchPlans().then(setPlans, () => setPlans('error'));
  }, []);
  const loadEvents = useCallback(() => {
    if (!admin) return;
    setEvents('loading');
    fetchRuns({ planId: '', result: '', limit: LATEST_RUNS }).then(
      (page) => setEvents(page.items),
      () => setEvents('error'),
    );
  }, [admin]);
  useEffect(() => {
    fetchStatus().then(
      (report: StatusReport) => setCoverage(coverageOf(report.rows)),
      () => setCoverage('error'),
    );
    loadPlans();
    loadEvents();
  }, [loadPlans, loadEvents]);
  return (
    <div className="home-coverage">
      <CoverageTiles coverage={coverage} />
      <NextBackup
        plans={plans}
        admin={admin}
        now={new Date()}
        onLaunched={() => {
          loadPlans();
          loadEvents();
        }}
      />
      {admin && (
        <LatestEvents
          items={events}
          plans={Array.isArray(plans) ? plans : []}
          onRetry={loadEvents}
        />
      )}
    </div>
  );
}
