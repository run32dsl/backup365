import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { type Problem as FailureProblem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { AccessDenied } from './AccessDenied.js';
import { StorageUnavailable } from './StorageUnavailable.js';
import { cardSummary, dateTimeOrDash } from './format.js';
import { RESTORE_LABELS } from './restoreLabels.js';
import { RestoreNotConfigured } from './RestoreAction.js';
import {
  AuditReminder,
  REASON,
  RESTORE_BUTTONS as B,
  RESTORE_STEPS,
  ReasonField,
  RestoreResult,
  RunningProgress,
  stepOf,
} from './RestoreJourney.js';
import { isReasonValid } from './mail.js';
import {
  SCOPE_OPTIONS,
  SHAREPOINT_MESSAGES as T,
  canContinue,
  continueHint,
  dateTimeOf,
  failureCause,
  fetchLastSiteJob,
  fetchScope,
  fetchSiteEntries,
  fetchSiteRestoreConfigured,
  fetchSiteSnapshots,
  fetchSites,
  formatDuration,
  failureSummary,
  isOutcomeUncertain,
  pathLabel,
  successSummary,
  breadcrumbLevels,
  breadcrumbLink,
  sharePointHash,
  sizeOf,
  startSiteRestore,
  restoredContentLabel,
  confirmRowsOf,
  consequenceOf,
  type Site,
  type SiteEntry,
  type SiteJob,
  type SiteScope,
  type SiteScopeSummary,
  type SharePointRoute,
} from './sharepoint.js';
import type { Loaded } from './onedrive.js';
import type { DriveSnapshot } from '@backup365/core';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Steps,
  WizardActions,
  ResultList,
} from './ui/index.js';

/** Ce qui a été choisi à l'étape 1. */
interface Choice {
  scope: SiteScope;
  /** `/` pour le site entier. */
  path: string;
  snapshotId: string;
  pointAt: string;
}

export function Problem({
  status,
  onRetry,
}: {
  status: 'unconfigured' | 'no_backup' | 'error';
  onRetry: () => void;
}) {
  if (status === 'unconfigured') {
    return <StorageUnavailable onRetry={onRetry} />;
  }
  if (status === 'no_backup') {
    return (
      <EmptyState action={<a href="#/plans">Configurer la sauvegarde SharePoint</a>}>
        {T.noSites}
      </EmptyState>
    );
  }
  return (
    <div role="alert" className="empty">
      <p>{T.readError}</p>
      <Button onClick={onRetry}>Réessayer</Button>
    </div>
  );
}

/** Liste d'un niveau du site : même présentation que celle d'OneDrive (`EntriesTable`). */
export function SiteEntriesTable({
  siteId,
  scope,
  rows,
  file,
  onOpen,
  onFile,
}: {
  siteId: string;
  scope: SiteScope;
  rows: SiteEntry[];
  file: string | null;
  onOpen: (path: string) => void;
  onFile: (path: string) => void;
}) {
  return (
    <div className="drive-list">
      <DataTable
        caption="Contenu du site sauvegardé"
        hideCaption
        rows={rows}
        rowKey={(e) => e.path}
        onRowClick={
          scope === 'item'
            ? (e) => {
                if (e.kind === 'file') onFile(e.path);
              }
            : undefined
        }
        columns={[
          {
            header: 'Nom',
            className: 'card-title',
            cell: (e) => {
              if (e.kind === 'file') {
                return scope === 'item' ? (
                  <label className="choice">
                    <input
                      type="radio"
                      name="selection"
                      checked={file === e.path}
                      onChange={() => {
                        onFile(e.path);
                      }}
                    />{' '}
                    {e.name}
                  </label>
                ) : (
                  e.name
                );
              }
              return (
                <span className="choice">
                  <a {...breadcrumbLink({ path: e.path }, siteId, scope, onOpen)}>{e.name}</a>
                  <span className="cell-secondary-inline">
                    {e.kind === 'library' ? 'bibliothèque' : 'dossier'}
                  </span>
                </span>
              );
            },
          },
          {
            header: 'Version du (UTC)',
            className: 'card-hidden',
            cell: (e) => dateTimeOrDash(e.versionAt),
          },
          {
            header: 'Taille',
            className: 'card-hidden',
            cell: (e) => (e.kind === 'file' ? sizeOf(e.sizeBytes) : '—'),
          },
          {
            header: 'Détail',
            className: 'card-only',
            cell: (e) => (e.kind === 'file' ? cardSummary(e.versionAt, e.sizeBytes) : null),
          },
        ]}
      />
    </div>
  );
}

/**
 * Contenu du site à une date, un niveau à la fois : les bibliothèques et les dossiers sont des
 * liens qui ouvrent le niveau suivant, un fichier se choisit par son bouton radio (granularité
 * « élément »). Le chemin ouvert est le fil d'Ariane.
 */
export function ContentTree({
  siteId,
  siteName,
  snapshotId,
  scope,
  path,
  file,
  onPath,
  onFile,
}: {
  siteId: string;
  siteName: string;
  snapshotId: string;
  scope: SiteScope;
  path: string;
  file: string | null;
  onPath: (path: string) => void;
  onFile: (path: string | null) => void;
}) {
  const [entries, setEntries] = useState<Loaded<SiteEntry[]> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setEntries(null);
    void fetchSiteEntries(siteId, snapshotId, path).then((result) => {
      if (current) setEntries(result);
    });
    return () => {
      current = false;
    };
  }, [siteId, snapshotId, path, attempt]);

  const rows = entries?.status === 'ok' ? entries.data : [];
  const go = (to: string) => {
    onFile(null);
    onPath(to);
  };
  const crumbs = breadcrumbLevels(siteName, path);

  return (
    <>
      <nav aria-label="Fil d'Ariane">
        <ol className="breadcrumb">
          {crumbs.map((c, i) => (
            <li key={c.path}>
              {i === crumbs.length - 1 ? (
                <span aria-current="location">{c.label}</span>
              ) : (
                <a {...breadcrumbLink(c, siteId, scope, go)}>{c.label}</a>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div aria-busy={entries === null} aria-live="polite">
        {entries === null && <p role="status">{T.loading}</p>}
        {entries && entries.status !== 'ok' && (
          <Problem
            status={entries.status}
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {entries?.status === 'ok' && rows.length === 0 && <EmptyState>{T.emptyFolder}</EmptyState>}
        {rows.length > 0 && (
          <SiteEntriesTable
            siteId={siteId}
            scope={scope}
            rows={rows}
            file={file}
            onOpen={go}
            onFile={onFile}
          />
        )}
      </div>
    </>
  );
}

/** Étape 1 : site, granularité, contenu et point de restauration. */
export function ChooseStep({
  sites,
  site,
  snapshots,
  snapshotId,
  initialScope,
  initialPath,
  admin,
  configured,
  onSnapshot,
  onContinue,
}: {
  sites: Site[];
  site: Site;
  snapshots: DriveSnapshot[];
  snapshotId: string;
  initialScope: SiteScope;
  /** Dossier ouvert à l'arrivée : celui de l'ancre (lien du fil d'Ariane ouvert dans un onglet). */
  initialPath: string;
  admin: boolean;
  configured: boolean;
  onSnapshot: (id: string) => void;
  onContinue: (choice: Choice) => void;
}) {
  const [scope, setScope] = useState<SiteScope>(initialScope);
  const [path, setPath] = useState(initialPath);
  const [file, setFile] = useState<string | null>(null);
  const hintId = useId();
  const notConfiguredId = useId();
  const ok = canContinue(scope, path, file);
  const target = scope === 'item' ? (file ?? path) : path;
  const point = snapshots.find((s) => s.id === snapshotId);
  const blocked = !ok || !configured;

  return (
    <>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="sp-site">Site</label>
          <select
            id="sp-site"
            value={site.id}
            onChange={(e) => {
              window.location.hash = sharePointHash(e.currentTarget.value, scope);
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sp-point">{RESTORE_LABELS.backupDate}</label>
          <select
            id="sp-point"
            value={snapshotId}
            onChange={(e) => {
              onSnapshot(e.currentTarget.value);
              setPath('/');
              setFile(null);
            }}
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {dateTimeOf(s.createdAt)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="choices">
        <legend>Restaurer</legend>
        {SCOPE_OPTIONS.map((o) => {
          const locked = o.value === 'site' && !admin;
          return (
            <div key={o.value} className="choice-item">
              <label className="choice">
                <input
                  type="radio"
                  name="scope"
                  value={o.value}
                  checked={scope === o.value}
                  disabled={locked}
                  aria-describedby={locked ? `${hintId}-admin` : undefined}
                  onChange={() => {
                    setScope(o.value);
                    setPath('/');
                    setFile(null);
                  }}
                />
                {o.label}
              </label>
              {locked && (
                <p id={`${hintId}-admin`} className="field-help choice-help">
                  {T.adminOnly}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      {scope === 'site' ? (
        <p>Tout le contenu de « {site.displayName} » sera concerné.</p>
      ) : (
        <ContentTree
          key={`${snapshotId}-${scope}`}
          siteId={site.id}
          siteName={site.displayName}
          snapshotId={snapshotId}
          scope={scope}
          path={path}
          file={file}
          onPath={setPath}
          onFile={setFile}
        />
      )}

      <p aria-live="polite">
        {scope === 'site'
          ? 'Sélection : le site entier'
          : ok
            ? `Sélection : ${pathLabel(target)}`
            : 'Aucune sélection'}
      </p>
      <WizardActions>
        <Button
          aria-disabled={blocked || undefined}
          className={blocked ? 'is-inactive' : undefined}
          aria-describedby={!configured ? notConfiguredId : !ok ? hintId : undefined}
          onClick={() => {
            if (!blocked && point) {
              onContinue({
                scope,
                path: scope === 'item' ? (file ?? '/') : path,
                snapshotId,
                pointAt: point.createdAt,
              });
            }
          }}
        >
          {B.next}
        </Button>
      </WizardActions>
      {!ok && (
        <p id={hintId} className="field-help">
          {continueHint(scope)}
        </p>
      )}
      {!configured && <RestoreNotConfigured id={notConfiguredId} />}
    </>
  );
}

/** Étape 2 : le motif est demandé avant la confirmation. */
function ReasonStep({
  initial,
  onBack,
  onContinue,
}: {
  initial: string;
  onBack: () => void;
  onContinue: (reason: string) => void;
}) {
  const [reason, setReason] = useState(initial);
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isReasonValid(reason)) {
      setError(REASON.error);
      return;
    }
    onContinue(reason.trim());
  }

  return (
    <form onSubmit={submit} noValidate>
      <ReasonField value={reason} error={error} onChange={setReason} />
      <WizardActions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button type="submit">{B.next}</Button>
      </WizardActions>
    </form>
  );
}

/** Étape 3 : récapitulatif ; site entier : double confirmation (case, puis nom du site). */
export function ConfirmStep({
  site,
  choice,
  reason,
  onBack,
  onStarted,
}: {
  site: Site;
  choice: Choice;
  reason: string;
  onBack: () => void;
  onStarted: (job: SiteJob) => void;
}) {
  const [summary, setSummary] = useState<Loaded<SiteScopeSummary> | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState('');
  const [nameError, setNameError] = useState(false);
  const [failure, setFailure] = useState<FailureProblem | undefined>();
  const [sending, setSending] = useState(false);
  const whole = choice.scope === 'site';
  const nameOk = typed === site.displayName;
  const ready = !whole || (understood && nameOk);

  useEffect(() => {
    let current = true;
    void fetchScope(site.id, choice.snapshotId, choice.path).then((result) => {
      if (current) setSummary(result);
    });
    return () => {
      current = false;
    };
  }, [site.id, choice.snapshotId, choice.path]);

  const counts = summary?.status === 'ok' ? summary.data : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setFailure(undefined);
    if (whole && !nameOk) {
      setNameError(typed !== '');
      return;
    }
    if (!ready) return;
    setSending(true);
    void startSiteRestore(site.id, {
      snapshotId: choice.snapshotId,
      scope: choice.scope,
      path: choice.path,
      reason,
      ...(whole ? { confirmName: typed } : {}),
    }).then((result) => {
      setSending(false);
      if (result.ok) onStarted(result.job);
      else setFailure({ message: result.message, requestId: result.requestId });
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2>Récapitulatif</h2>
      <ResultList
        rows={confirmRowsOf({
          scope: choice.scope,
          siteName: site.displayName,
          path: choice.path,
          pointAt: choice.pointAt,
          summary: counts,
          reason,
        })}
      />
      <p>{consequenceOf(choice.scope)}</p>
      {summary === null && <p role="status">{T.loading}</p>}
      {whole && (
        <>
          <Alert tone="warning">
            <strong>Restauration du site entier : action de grande ampleur</strong>
          </Alert>
          <div className="field">
            <label className="choice">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => {
                  setUnderstood(e.currentTarget.checked);
                }}
              />{' '}
              Je comprends que tous les contenus manquants seront recréés
            </label>
          </div>
          <FormField
            label="Tapez le nom du site pour confirmer"
            type="text"
            name="site-name"
            autoComplete="off"
            value={typed}
            help={ready ? undefined : T.inactiveHint}
            error={nameError ? T.nameError : undefined}
            onChange={(e) => {
              setTyped(e.currentTarget.value);
              setNameError(false);
            }}
          />
        </>
      )}
      {failure && <FailureAlert problem={failure} />}
      <WizardActions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button
          type="submit"
          variant={whole ? 'danger' : 'primary'}
          busy={sending}
          aria-disabled={!ready || undefined}
          className={ready ? undefined : 'is-inactive'}
        >
          {B.confirm}
        </Button>
      </WizardActions>
    </form>
  );
}

/** Étape 4 : progression, puis résultat. La restauration continue si l'on quitte la page. */
export function TrackStep({
  job,
  pointAt,
  siteName,
  onJob,
  onAgain,
  onRetry,
}: {
  job: SiteJob;
  pointAt?: string | undefined;
  siteName: string;
  onJob: (job: SiteJob) => void;
  onAgain: () => void;
  onRetry: () => void;
}) {
  const running = job.status === 'running';
  useEffect(() => {
    if (!running) return;
    let current = true;
    let failures = 0;
    const timer = setInterval(() => {
      fetchLastSiteJob(job.siteId).then(
        (last) => {
          if (!current) return;
          failures = 0;
          if (last && last.id === job.id && last.status !== 'running') onJob(last);
          else if (!last || last.id !== job.id) {
            // Le serveur a perdu la trace (redémarrage) : on n'attend pas indéfiniment.
            onJob({ ...job, status: 'failed', error: 'restore_lost', durationMs: null });
          }
        },
        () => {
          failures += 1;
          if (current && failures >= 5) {
            onJob({ ...job, status: 'failed', error: 'restore_lost', durationMs: null });
          }
        },
      );
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
    // `job` ne change que par `onJob` ; `onJob` est stable (état du parent).
  }, [running, job.id, job.siteId]);

  const untreated = Math.max(0, job.total - job.restored - job.skipped - job.errors);
  const failedNormally = job.status === 'failed' && !isOutcomeUncertain(job.error);
  const countRows: [string, ReactNode][] = [
    ['Site', siteName],
    [RESTORE_LABELS.itemRestored, restoredContentLabel(job.scope, job.path)],
  ];
  if (pointAt) countRows.push([RESTORE_LABELS.backupAt, dateTimeOf(pointAt)]);
  if (job.status === 'succeeded' && job.copyName) countRows.push(['Restauré sous', job.copyName]);
  if (failedNormally && untreated > 0) countRows.push(['Éléments non traités', untreated]);
  if (job.status !== 'running' && job.errors > 0) {
    countRows.push(['Éléments en erreur', job.errors]);
  }
  const counts = <ResultList rows={countRows} />;
  let body: ReactNode;
  if (running) {
    body = (
      <>
        <RunningProgress
          detail={`${job.total} ${job.total > 1 ? 'éléments' : 'élément'} à traiter`}
        />
        {counts}
        <p>Vous pouvez quitter cette page, la restauration continue.</p>
      </>
    );
  } else if (job.status === 'succeeded') {
    body = (
      <>
        <div aria-live="polite">
          <Alert tone="success">
            {successSummary(
              job.restored,
              job.skipped,
              job.errors,
              formatDuration(job.durationMs ?? 0),
            )}
          </Alert>
        </div>
        {counts}
        {job.skipped === 0 && <p>Aucun élément déjà présent n’a été écrasé.</p>}
        <WizardActions
          back={
            <a className="btn btn-secondary" href="#/audit">
              {B.audit}
            </a>
          }
        >
          <Button onClick={onAgain}>{B.again}</Button>
        </WizardActions>
      </>
    );
  } else {
    body = (
      <>
        <Alert tone="error">
          {isOutcomeUncertain(job.error)
            ? `La restauration a échoué : ${failureCause(job.error)}. L’état de SharePoint est incertain : vérifiez avant de réessayer.`
            : failureSummary(job.restored)}
        </Alert>
        {counts}
        <WizardActions
          back={
            <a className="btn btn-secondary" href="#/audit">
              {B.audit}
            </a>
          }
        >
          <Button onClick={onRetry}>{B.retry}</Button>
        </WizardActions>
      </>
    );
  }
  return <RestoreResult status={job.status}>{body}</RestoreResult>;
}

/** Refus de droit sur un site : situation normale, expliquée, avec une seule issue (étape « Choisir »). */
export function SiteDenied({ site }: { site: Site }) {
  return (
    <AccessDenied
      title="Restauration non autorisée :"
      href={sharePointHash(site.id)}
      exit={T.chooseOther}
    >
      {T.forbiddenSite(site.displayName)}
    </AccessDenied>
  );
}

/**
 * Restaurer SharePoint : choisir, motif, confirmation, suivi
 * (`#/sharepoint/<site>/<granularité>/<dossier>...`).
 */
export function SharePointPage({ route, admin }: { route: SharePointRoute; admin: boolean }) {
  const [sites, setSites] = useState<Loaded<Site[]> | null>(null);
  const [snapshots, setSnapshots] = useState<Loaded<DriveSnapshot[]> | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [job, setJob] = useState<SiteJob | null>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let current = true;
    setSites(null);
    void fetchSites().then((result) => {
      if (current) setSites(result);
    });
    void fetchSiteRestoreConfigured().then((value) => {
      if (current) setConfigured(value);
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const list = sites?.status === 'ok' ? sites.data : [];
  const site = list.find((s) => s.id === route.site) ?? list[0];
  const siteId = site?.id ?? '';
  useEffect(() => {
    if (!siteId) return;
    let current = true;
    setSnapshots(null);
    setSnapshotId(null);
    void fetchSiteSnapshots(siteId).then((result) => {
      if (!current) return;
      setSnapshots(result);
      if (result.status === 'ok') setSnapshotId(result.data[0]?.id ?? null);
    });
    return () => {
      current = false;
    };
  }, [siteId, attempt]);

  const step = job ? 4 : reason ? 3 : choice ? 2 : 1;
  useEffect(() => {
    if (step > 1) titleRef.current?.focus();
  }, [step]);

  const retry = () => {
    setAttempt((n) => n + 1);
  };
  const reset = () => {
    setChoice(null);
    setReason(null);
    setJob(null);
  };

  const direct = route.scope === 'site' && !admin;
  let content: ReactNode;
  if (sites === null) {
    content = (
      <p role="status" aria-busy="true">
        {T.loadingPoints}
      </p>
    );
  } else if (sites.status !== 'ok') {
    content = <Problem status={sites.status} onRetry={retry} />;
  } else if (!site) {
    content = <Problem status="no_backup" onRetry={retry} />;
  } else if (direct) {
    content = <SiteDenied site={site} />;
  } else if (
    snapshots === null ||
    (snapshots.status === 'ok' && snapshotId === null && snapshots.data.length > 0)
  ) {
    content = (
      <p role="status" aria-busy="true">
        {T.loadingPoints}
      </p>
    );
  } else if (snapshots.status !== 'ok') {
    content = <Problem status={snapshots.status} onRetry={retry} />;
  } else if (snapshotId === null) {
    content = <EmptyState>{T.noPoints}</EmptyState>;
  } else if (job) {
    content = (
      <TrackStep
        key={job.id}
        job={job}
        pointAt={choice?.pointAt}
        siteName={site.displayName}
        onJob={setJob}
        onAgain={reset}
        onRetry={() => {
          setJob(null);
        }}
      />
    );
  } else if (choice && reason) {
    content = (
      <ConfirmStep
        site={site}
        choice={choice}
        reason={reason}
        onBack={() => {
          setReason(null);
        }}
        onStarted={setJob}
      />
    );
  } else if (choice) {
    content = (
      <ReasonStep
        initial={draft}
        onBack={() => {
          setChoice(null);
        }}
        onContinue={(r) => {
          setDraft(r);
          setReason(r);
        }}
      />
    );
  } else {
    content = (
      <ChooseStep
        key={site.id}
        sites={list}
        site={site}
        snapshots={snapshots.data}
        snapshotId={snapshotId}
        initialScope={route.scope ?? 'item'}
        initialPath={route.path}
        admin={admin}
        configured={configured}
        onSnapshot={setSnapshotId}
        onContinue={setChoice}
      />
    );
  }

  const journey = !!site && (direct || snapshotId !== null);
  return (
    <main tabIndex={-1}>
      <h1>{T.title}</h1>
      {journey && <Steps steps={RESTORE_STEPS} current={stepOf(step)} titleRef={titleRef} />}
      {journey && !direct && <AuditReminder />}
      {content}
    </main>
  );
}
