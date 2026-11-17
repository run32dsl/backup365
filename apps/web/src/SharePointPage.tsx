import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { RestoreNotConfigured } from './RestoreAction.js';
import {
  AuditReminder,
  REASON,
  RESTORE_BUTTONS as B,
  RESTORE_STEPS,
  ReasonField,
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
  failureDetail,
  failureSummary,
  isOutcomeUncertain,
  pathLabel,
  successSummary,
  breadcrumbLevels,
  breadcrumbLink,
  sharePointHash,
  sizeOf,
  startSiteRestore,
  summaryOf,
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
  ChoiceGroup,
  EmptyState,
  FormField,
  Steps,
  WizardActions,
} from './ui/index.js';

/** Ce qui a été choisi à l'étape 1. */
interface Choice {
  scope: SiteScope;
  /** `/` pour le site entier. */
  path: string;
  snapshotId: string;
  pointAt: string;
}

function Problem({
  status,
  onRetry,
}: {
  status: 'unconfigured' | 'no_backup' | 'error';
  onRetry: () => void;
}) {
  if (status === 'unconfigured') {
    return (
      <EmptyState action={<a href="#/">Configurer la connexion</a>}>{T.notConfigured}</EmptyState>
    );
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

/**
 * Arborescence du site à une date : une bibliothèque, un dossier ou un fichier à la fois
 * (`role="tree"`), flèches haut et bas pour se déplacer, Entrée pour ouvrir un dossier ou choisir un
 * fichier. Le chemin ouvert est le fil d'Ariane.
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
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    let current = true;
    setEntries(null);
    setActive(0);
    void fetchSiteEntries(siteId, snapshotId, path).then((result) => {
      if (current) setEntries(result);
    });
    return () => {
      current = false;
    };
  }, [siteId, snapshotId, path, attempt]);

  const rows = entries?.status === 'ok' ? entries.data : [];
  // Ouvrir un dossier remplace la liste : le focus passe au premier élément de la nouvelle.
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current && entries?.status === 'ok' && entries.data.length > 0) {
      moved.current = false;
      refs.current[0]?.focus();
    }
  }, [entries]);
  const go = (to: string) => {
    moved.current = true;
    onFile(null);
    onPath(to);
  };
  const crumbs = breadcrumbLevels(siteName, path);

  function open(e: SiteEntry) {
    if (e.kind === 'file') {
      if (scope === 'item') onFile(e.path);
    } else {
      go(e.path);
    }
  }

  function onKey(ev: KeyboardEvent<HTMLUListElement>) {
    const move = (to: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, to));
      setActive(next);
      refs.current[next]?.focus();
      ev.preventDefault();
    };
    if (ev.key === 'ArrowDown') move(active + 1);
    else if (ev.key === 'ArrowUp') move(active - 1);
    else if (ev.key === 'Home') move(0);
    else if (ev.key === 'End') move(rows.length - 1);
    else if (ev.key === 'Enter' || ev.key === ' ') {
      const row = rows[active];
      if (row) open(row);
      ev.preventDefault();
    } else if (ev.key === 'ArrowLeft' && crumbs.length > 1) {
      go(crumbs[crumbs.length - 2]?.path ?? '/');
      ev.preventDefault();
    }
  }

  return (
    <>
      <nav aria-label="Chemin">
        <ol className="breadcrumb">
          {crumbs.map((c, i) => (
            <li key={c.path}>
              {i === crumbs.length - 1 ? (
                <span aria-current="page">{c.label}</span>
              ) : (
                <a className="btn btn-secondary" {...breadcrumbLink(c, siteId, scope, go)}>
                  {c.label}
                </a>
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
          <ul
            role="tree"
            aria-label="Contenu du site sauvegardé"
            className="site-tree"
            onKeyDown={onKey}
          >
            {rows.map((e, i) => {
              const selectable = e.kind !== 'file' || scope === 'item';
              return (
                <li
                  key={e.path}
                  role="treeitem"
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  tabIndex={i === active ? 0 : -1}
                  aria-selected={e.kind === 'file' ? file === e.path : undefined}
                  aria-disabled={!selectable || undefined}
                  className={`site-node${file === e.path ? ' is-selected' : ''}`}
                  onClick={() => {
                    setActive(i);
                    open(e);
                  }}
                  onFocus={() => {
                    setActive(i);
                  }}
                >
                  <span aria-hidden="true">
                    {e.kind === 'library' ? '🗂' : e.kind === 'folder' ? '📁' : '📄'}
                  </span>{' '}
                  {e.name}
                  <span className="sr-only">
                    {e.kind === 'library'
                      ? ' (bibliothèque)'
                      : e.kind === 'folder'
                        ? ' (dossier)'
                        : ' (fichier)'}
                  </span>
                  <span className="site-node-meta">
                    {dateTimeOf(e.versionAt)}
                    {e.kind === 'file' ? ` · ${sizeOf(e.sizeBytes)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/** Étape 1 : site, granularité, contenu et point de restauration. */
function ChooseStep({
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
          <label htmlFor="sp-point">Point de restauration</label>
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

      <ChoiceGroup
        legend="Restaurer"
        name="scope"
        value={scope}
        options={SCOPE_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          disabled: o.value === 'site' && !admin,
          hint: o.value === 'site' && !admin ? T.adminOnly : undefined,
        }))}
        onChange={(next) => {
          setScope(next);
          setPath('/');
          setFile(null);
        }}
      />

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
function ConfirmStep({
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
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const hintId = useId();
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
      else setFailure(result.message);
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      {whole ? (
        <>
          <Alert tone="warning">
            <strong>Restauration du site entier : action de grande ampleur</strong>
          </Alert>
          <p>
            {site.displayName} · point du {dateTimeOf(choice.pointAt)}
            {counts ? ` · ${counts.items} éléments` : ''}
          </p>
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
          <FormField
            label="Tapez le nom du site pour confirmer"
            type="text"
            name="site-name"
            autoComplete="off"
            value={typed}
            error={nameError ? T.nameError : undefined}
            onChange={(e) => {
              setTyped(e.currentTarget.value);
              setNameError(false);
            }}
          />
        </>
      ) : (
        <p>
          {summaryOf({
            scope: choice.scope,
            siteName: site.displayName,
            path: choice.path,
            pointAt: choice.pointAt,
            summary: counts,
          })}
        </p>
      )}
      {summary === null && <p role="status">{T.loading}</p>}
      <p>Motif : {reason}</p>
      {failure && <Alert tone="error">{failure}</Alert>}
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
          aria-describedby={!ready ? hintId : undefined}
        >
          {B.confirm}
        </Button>
      </WizardActions>
      {!ready && (
        <p id={hintId} className="field-help">
          Le bouton reste inactif tant que la case n’est pas cochée et que le nom du site n’est pas
          exact.
        </p>
      )}
    </form>
  );
}

/** Étape 4 : progression, puis résultat. La restauration continue si l'on quitte la page. */
function TrackStep({
  job,
  onJob,
  onAgain,
  onRetry,
}: {
  job: SiteJob;
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
  let body: ReactNode;
  if (running) {
    body = (
      <>
        <RunningProgress
          detail={`${job.total} ${job.total > 1 ? 'éléments' : 'élément'} à traiter`}
        />
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
        <p>Aucun élément déjà présent n’a été écrasé.</p>
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
        {!isOutcomeUncertain(job.error) && failureDetail(untreated, job.errors) && (
          <p>{failureDetail(untreated, job.errors)}</p>
        )}
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
  return <>{body}</>;
}

/** Restaurer SharePoint : choisir, motif, confirmation, suivi (`#/sharepoint/<site>/<granularité>`). */
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
    content = (
      <>
        <Alert tone="error">{T.forbidden}</Alert>
        <a className="btn btn-secondary" href={sharePointHash(site.id)}>
          {B.back}
        </a>
      </>
    );
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

  const journey = snapshotId !== null && !!site && !direct;
  return (
    <main tabIndex={-1}>
      <h1>{T.title}</h1>
      {journey && <Steps steps={RESTORE_STEPS} current={stepOf(step)} titleRef={titleRef} />}
      {journey && <AuditReminder />}
      {content}
    </main>
  );
}
