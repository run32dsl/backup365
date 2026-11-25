import { nextRunAt, type StatusReport, type StatusRow } from '@backup365/core';
import { useCallback, useEffect, useState } from 'react';
import { fetchAudit, type AuditItem } from './audit.js';
import { ACTION_LABELS, actorLabel, auditDate } from './auditLabels.js';
import { plural, quoted } from './format.js';
import { fetchPlans, runPlan, runReasonError, type PlanItem } from './plans.js';
import { REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import { AUDIT_HASH, STATUS_HASH } from './routes.js';
import { fetchStatus } from './status.js';
import { Alert, Button, Dialog } from './ui/index.js';

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
        {failures.length > 0 && (
          <Alert tone="error">
            <ul>
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

/** Les cinq derniers lancements manuels du journal d'audit, un par ligne. */
export function LatestEvents({
  items,
  onRetry,
}: {
  items: AuditItem[] | 'loading' | 'error';
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
          <caption className="sr-only">Cinq derniers événements du journal</caption>
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Événement</th>
              <th scope="col">Par</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.seq}>
                <td data-label="Heure">{auditDate(e.at)} UTC</td>
                <td data-label="Événement">{ACTION_LABELS[e.action]}</td>
                <td data-label="Par">{actorLabel(e.actor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <a href={AUDIT_HASH}>Tout voir dans le journal</a>
      </p>
    </section>
  );
}

/** Bloc de l'accueil sous les trois cartes : couverture, prochaine sauvegarde, derniers événements. */
export function HomeCoverage({ admin }: { admin: boolean }) {
  const [coverage, setCoverage] = useState<Coverage | 'loading' | 'error'>('loading');
  const [plans, setPlans] = useState<PlanItem[] | 'loading' | 'error'>('loading');
  const [events, setEvents] = useState<AuditItem[] | 'loading' | 'error'>('loading');
  const loadPlans = useCallback(() => {
    fetchPlans().then(setPlans, () => setPlans('error'));
  }, []);
  const loadEvents = useCallback(() => {
    if (!admin) return;
    setEvents('loading');
    fetchAudit({ action: 'plan.run', limit: 5 }).then(
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
      {admin && <LatestEvents items={events} onRetry={loadEvents} />}
    </div>
  );
}
