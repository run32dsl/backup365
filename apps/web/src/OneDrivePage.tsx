import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { parentOf } from '@backup365/core';
import { API_ERRORS, type Problem as FailureProblem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { dateTimeOrDash } from './format.js';
import { isReasonValid } from './mail.js';
import {
  ONEDRIVE_MESSAGES as T,
  breadcrumbOf,
  copyNameOf,
  dateTimeOf,
  dayOf,
  failureCause,
  fetchAccounts,
  fetchDriveRestoreConfigured,
  fetchEntries,
  fetchLastDriveJob,
  fetchSnapshots,
  fetchVersions,
  isOutcomeUncertain,
  oneDriveHash,
  sizeOf,
  startDriveRestore,
  summaryOf,
  type DriveEntry,
  type DriveJob,
  type DriveMode,
  type DriveSnapshot,
  type DriveVersion,
  type Loaded,
  type OneDriveRoute,
} from './onedrive.js';
import { RestoreNotConfigured } from './RestoreAction.js';
import {
  AuditReminder,
  REASON,
  RESTORE_BUTTONS as B,
  RESTORE_STEPS,
  ReasonField,
  RestoreResult,
  ResultList,
  RunningProgress,
  stepOf,
} from './RestoreJourney.js';
import { formatDuration } from './restore.js';
import {
  Alert,
  Button,
  ChoiceGroup,
  DataTable,
  Dialog,
  EmptyState,
  Steps,
  WizardActions,
} from './ui/index.js';

/** Élément choisi à l'étape 1 : un fichier ou un dossier, éventuellement une version précise. */
interface Choice {
  entry: DriveEntry;
  snapshotId: string;
  version?: DriveVersion | undefined;
}

/** Dossier d'un chemin, pour les phrases : `Documents > Budget`, `la racine` sinon. */
function folderLabel(path: string): string {
  const parent = parentOf(path);
  return parent === '/' ? 'la racine' : parent.split('/').filter(Boolean).join(' > ');
}

export function Problem({
  status,
  onRetry,
}: {
  status: 'unconfigured' | 'no_backup' | 'error';
  onRetry: () => void;
}) {
  if (status === 'unconfigured') {
    return <EmptyState>{API_ERRORS['catalog_unavailable']}</EmptyState>;
  }
  if (status === 'no_backup') {
    return (
      <EmptyState action={<a href="#/">Voir l’état des sauvegardes</a>}>{T.noBackup}</EmptyState>
    );
  }
  return (
    <div role="alert" className="empty">
      <p>{T.readError}</p>
      <Button onClick={onRetry}>Réessayer</Button>
    </div>
  );
}

/** Panneau des versions d'un fichier : une seule choisie, puis « Restaurer cette version ». */
function VersionsDialog({
  account,
  entry,
  onChoose,
  onClose,
}: {
  account: string;
  entry: DriveEntry;
  onChoose: (version: DriveVersion) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Loaded<DriveVersion[]> | null>(null);
  const [picked, setPicked] = useState<number>(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setVersions(null);
    void fetchVersions(account, entry.path).then((result) => {
      if (current) setVersions(result);
    });
    return () => {
      current = false;
    };
  }, [account, entry.path, attempt]);

  const rows = versions?.status === 'ok' ? versions.data : [];
  return (
    <Dialog open title={`Versions de ${entry.name}`} onClose={onClose}>
      {versions === null && (
        <p role="status" aria-busy="true">
          {T.loading}
        </p>
      )}
      {versions && versions.status !== 'ok' && (
        <Problem
          status={versions.status}
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {versions?.status === 'ok' && rows.length === 0 && <p role="status">{T.noVersions}</p>}
      {rows.length > 0 && (
        <fieldset className="choices choice-list">
          <legend className="sr-only">Versions de {entry.name}</legend>
          {rows.map((v, i) => (
            <label key={`${v.snapshotId}-${v.versionId ?? ''}`} className="choice">
              <input
                type="radio"
                name="version"
                checked={picked === i}
                onChange={() => {
                  setPicked(i);
                }}
              />{' '}
              {dateTimeOf(v.at)}
              {v.current ? ' · Actuelle sauvegardée' : ''} · {sizeOf(v.sizeBytes)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="button-row dialog-actions primary-first">
        <Button
          disabled={rows.length === 0}
          onClick={() => {
            const chosen = rows[picked];
            if (chosen) onChoose(chosen);
          }}
        >
          Restaurer cette version
        </Button>
        <Button variant="secondary" data-safe onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Dialog>
  );
}

/** Liste des éléments d'un dossier sauvegardé : le bouton radio porte le nom de l'élément. */
export function EntriesTable({
  account,
  rows,
  selected,
  emptyMessage,
  onSelect,
  onVersions,
}: {
  account: string;
  rows: DriveEntry[];
  selected: string | null;
  emptyMessage: string;
  onSelect: (path: string) => void;
  onVersions: (entry: DriveEntry, button: HTMLButtonElement) => void;
}) {
  const prefix = useId();
  const nameId = (e: DriveEntry) => `${prefix}-${rows.indexOf(e)}`;
  const radio = (e: DriveEntry, labelledBy?: string) => (
    <input
      type="radio"
      name="selection"
      aria-labelledby={labelledBy}
      checked={selected === e.path}
      onChange={() => {
        onSelect(e.path);
      }}
    />
  );
  return (
    <DataTable
      caption="Contenu du dossier sauvegardé"
      hideCaption
      rows={rows}
      rowKey={(e) => e.path}
      empty={{ message: emptyMessage }}
      columns={[
        {
          header: 'Nom',
          cell: (e) =>
            e.kind === 'folder' ? (
              <span className="choice">
                {radio(e, nameId(e))}
                <a id={nameId(e)} href={oneDriveHash(account, e.path)}>
                  {e.name}
                </a>
                <span className="cell-secondary-inline">dossier</span>
              </span>
            ) : (
              <label className="choice">
                {radio(e)} {e.name}
              </label>
            ),
        },
        { header: 'Version du (UTC)', cell: (e) => dateTimeOrDash(e.versionAt) },
        { header: 'Taille', cell: (e) => (e.sizeBytes === null ? '—' : sizeOf(e.sizeBytes)) },
        {
          header: 'Versions',
          cell: (e) =>
            e.kind === 'file' ? (
              <Button
                variant="secondary"
                aria-label={`Versions de ${e.name}`}
                onClick={(ev) => {
                  onVersions(e, ev.currentTarget);
                }}
              >
                Versions
              </Button>
            ) : (
              '—'
            ),
        },
      ]}
    />
  );
}

/** Étape 1 : parcourir la sauvegarde et choisir un élément. */
function BrowseStep({
  route,
  account,
  accounts,
  snapshots,
  snapshotId,
  onSnapshot,
  configured,
  onChoose,
}: {
  route: OneDriveRoute;
  account: string;
  accounts: { id: string; displayName: string }[];
  snapshots: DriveSnapshot[];
  snapshotId: string;
  onSnapshot: (id: string) => void;
  configured: boolean;
  onChoose: (choice: Choice) => void;
}) {
  const [entries, setEntries] = useState<Loaded<DriveEntry[]> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [versionsOf, setVersionsOf] = useState<DriveEntry | null>(null);
  const [attempt, setAttempt] = useState(0);
  const versionsButton = useRef<HTMLButtonElement | null>(null);
  const hintId = useId();
  const path = route.path;

  useEffect(() => {
    let current = true;
    setEntries(null);
    setSelected(null);
    void fetchEntries(account, snapshotId, path).then((result) => {
      if (current) setEntries(result);
    });
    return () => {
      current = false;
    };
  }, [account, snapshotId, path, attempt]);

  const rows = entries?.status === 'ok' ? entries.data : [];
  const chosen = rows.find((e) => e.path === selected);
  const snapshot = snapshots.find((s) => s.id === snapshotId);

  return (
    <>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="od-account">Compte</label>
          <select
            id="od-account"
            value={account}
            onChange={(e) => {
              window.location.hash = oneDriveHash(e.currentTarget.value, '/');
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="od-snapshot">Date de la sauvegarde</label>
          <select
            id="od-snapshot"
            value={snapshotId}
            onChange={(e) => {
              onSnapshot(e.currentTarget.value);
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
      <nav aria-label="Chemin">
        <ol className="breadcrumb">
          {breadcrumbOf(path).map((c, i, all) => (
            <li key={c.path}>
              {i === all.length - 1 ? (
                <span aria-current="page">{c.label}</span>
              ) : (
                <a href={oneDriveHash(account, c.path)}>{c.label}</a>
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
        {entries?.status === 'ok' && (
          <fieldset className="choices drive-list">
            <legend className="sr-only">Éléments de {breadcrumbOf(path).at(-1)?.label}</legend>
            <EntriesTable
              account={account}
              rows={rows}
              selected={selected}
              emptyMessage={`Ce dossier est vide dans la sauvegarde du ${dayOf(snapshot?.createdAt ?? null)}.`}
              onSelect={setSelected}
              onVersions={(entry, button) => {
                versionsButton.current = button;
                setVersionsOf(entry);
              }}
            />
          </fieldset>
        )}
      </div>

      <p aria-live="polite">{chosen ? '1 élément sélectionné' : 'Aucun élément sélectionné'}</p>
      <WizardActions>
        <Button
          aria-disabled={!configured || !chosen || undefined}
          aria-describedby={!configured ? hintId : undefined}
          onClick={() => {
            if (configured && chosen) onChoose({ entry: chosen, snapshotId });
          }}
        >
          {B.next}
        </Button>
      </WizardActions>
      {!configured && <RestoreNotConfigured id={hintId} />}

      {versionsOf && (
        <VersionsDialog
          account={account}
          entry={versionsOf}
          onClose={() => {
            setVersionsOf(null);
          }}
          onChoose={(version) => {
            setVersionsOf(null);
            if (configured)
              onChoose({ entry: versionsOf, snapshotId: version.snapshotId, version });
          }}
        />
      )}
    </>
  );
}

/** Étape 2 : le motif. */
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

/** Étape 3 : mode et récapitulatif. */
function ConfirmStep({
  account,
  choice,
  reason,
  onBack,
  onStarted,
}: {
  account: string;
  choice: Choice;
  reason: string;
  onBack: () => void;
  onStarted: (job: DriveJob) => void;
}) {
  const { entry, version } = choice;
  const [mode, setMode] = useState<DriveMode>('copy');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [failure, setFailure] = useState<FailureProblem | undefined>();
  const [sending, setSending] = useState(false);
  const canReplace = entry.kind === 'file';
  const versionAt = version?.at ?? entry.versionAt;
  const copyName = version ? '' : copyNameOf(entry.name, entry.kind, new Date());

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setFailure(undefined);
    if (mode === 'replace' && !confirmed) {
      setConfirmError(true);
      return;
    }
    setConfirmError(false);
    setSending(true);
    void startDriveRestore(account, {
      snapshotId: choice.snapshotId,
      path: entry.path,
      kind: entry.kind,
      mode,
      versionId: version?.versionId ?? undefined,
      reason,
    }).then((result) => {
      setSending(false);
      if (result.ok) onStarted(result.job);
      else setFailure({ message: result.message, requestId: result.requestId });
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <p>Motif : {reason}</p>
      <ChoiceGroup<DriveMode>
        legend="Mode"
        name="mode"
        value={mode}
        options={[
          { value: 'copy', label: 'Restaurer en copie (recommandé)' },
          ...(canReplace
            ? [{ value: 'replace' as const, label: 'Remplacer le fichier actuel' }]
            : []),
        ]}
        onChange={(next) => {
          setMode(next);
          if (next === 'copy') {
            setConfirmed(false);
            setConfirmError(false);
          }
        }}
      />
      <h3>Récapitulatif</h3>
      <p>
        {summaryOf({
          name: entry.name,
          kind: entry.kind,
          mode,
          versionAt,
          folderLabel: folderLabel(entry.path),
          copyName,
        })}
      </p>
      {mode === 'replace' && (
        <div className="field">
          <label className="choice">
            <input
              type="checkbox"
              checked={confirmed}
              aria-invalid={confirmError || undefined}
              aria-describedby={confirmError ? 'od-confirm-error' : undefined}
              onChange={(e) => {
                setConfirmed(e.currentTarget.checked);
                setConfirmError(false);
              }}
            />{' '}
            {T.confirmReplace}
          </label>
          {confirmError && (
            <p id="od-confirm-error" className="field-error" role="alert">
              <span aria-hidden="true">✖</span> {T.confirmError}
            </p>
          )}
        </div>
      )}
      {failure && <FailureAlert problem={failure} />}
      <WizardActions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button type="submit" busy={sending}>
          {B.confirm}
        </Button>
      </WizardActions>
    </form>
  );
}

/** Étape 3 : suivi. La restauration continue si l'on quitte la page. */
function TrackStep({
  account,
  choice,
  job,
  onJob,
  onAgain,
  onRetry,
}: {
  account: string;
  choice: Choice;
  job: DriveJob;
  onJob: (job: DriveJob) => void;
  onAgain: () => void;
  onRetry: () => void;
}) {
  const running = job.status === 'running';
  useEffect(() => {
    if (!running) return;
    let current = true;
    let failures = 0;
    const timer = setInterval(() => {
      fetchLastDriveJob(account, job.path).then(
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
          // Session expirée ou serveur arrêté : après 5 échecs de suite, on cesse d'attendre.
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
  }, [running, account, job.id, job.path]);

  const target = job.copyName ?? choice.entry.name;
  const where = folderLabel(job.path);
  const items = (
    <ResultList
      rows={[
        [
          job.status === 'succeeded' ? 'Élément restauré' : 'Élément',
          `${choice.entry.name} → ${target}`,
        ],
        ...(job.status === 'succeeded' ? [['Emplacement', where] as [string, string]] : []),
      ]}
    />
  );
  let body: ReactNode;
  if (job.status === 'running') {
    body = (
      <>
        <RunningProgress />
        {items}
        <p>Vous pouvez quitter cette page, la restauration continue.</p>
      </>
    );
  } else if (job.status === 'succeeded') {
    body = (
      <>
        <Alert tone="success">
          Restauration terminée en {formatDuration(job.durationMs ?? 0)}.
        </Alert>
        {items}
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
          La restauration a échoué : {failureCause(job.error)}.{' '}
          {isOutcomeUncertain(job.error)
            ? 'L’état de OneDrive est incertain : vérifiez avant de réessayer.'
            : 'Rien n’a été modifié.'}
        </Alert>
        {items}
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

/** Restaurer depuis OneDrive : parcourir, motif et récapitulatif, suivi (`#/onedrive/<compte>/<chemin>`). */
export function OneDrivePage({ route }: { route: OneDriveRoute }) {
  const [accounts, setAccounts] = useState<Loaded<{ id: string; displayName: string }[]> | null>(
    null,
  );
  const [snapshots, setSnapshots] = useState<Loaded<DriveSnapshot[]> | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [job, setJob] = useState<DriveJob | null>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let current = true;
    setAccounts(null);
    void fetchAccounts().then((result) => {
      if (current) setAccounts(result);
    });
    void fetchDriveRestoreConfigured().then((value) => {
      if (current) setConfigured(value);
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const list = accounts?.status === 'ok' ? accounts.data : [];
  const account = route.account || list[0]?.id || '';
  useEffect(() => {
    if (!account) return;
    let current = true;
    setSnapshots(null);
    setSnapshotId(null);
    void fetchSnapshots(account).then((result) => {
      if (!current) return;
      setSnapshots(result);
      if (result.status === 'ok') setSnapshotId(result.data[0]?.id ?? null);
    });
    return () => {
      current = false;
    };
  }, [account, attempt]);

  const step = job ? 4 : reason !== null ? 3 : choice ? 2 : 1;
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

  let journey = false;
  let content: ReactNode;
  if (accounts === null) {
    content = (
      <p role="status" aria-busy="true">
        {T.loading}
      </p>
    );
  } else if (accounts.status !== 'ok') {
    content = <Problem status={accounts.status} onRetry={retry} />;
  } else if (list.length === 0) {
    content = <Problem status="no_backup" onRetry={retry} />;
  } else if (
    snapshots === null ||
    (snapshots.status === 'ok' && snapshotId === null && snapshots.data.length > 0)
  ) {
    content = (
      <p role="status" aria-busy="true">
        {T.loading}
      </p>
    );
  } else if (snapshots.status !== 'ok') {
    content = <Problem status={snapshots.status} onRetry={retry} />;
  } else if (snapshotId === null) {
    content = <Problem status="no_backup" onRetry={retry} />;
  } else if (job && choice) {
    journey = true;
    content = (
      <TrackStep
        key={job.id}
        account={account}
        choice={choice}
        job={job}
        onJob={setJob}
        onAgain={reset}
        onRetry={() => {
          setJob(null);
        }}
      />
    );
  } else if (choice && reason !== null) {
    journey = true;
    content = (
      <ConfirmStep
        account={account}
        choice={choice}
        reason={reason}
        onBack={() => {
          setReason(null);
        }}
        onStarted={setJob}
      />
    );
  } else if (choice) {
    journey = true;
    content = (
      <ReasonStep
        initial={draft}
        onBack={reset}
        onContinue={(r) => {
          setDraft(r);
          setReason(r);
        }}
      />
    );
  } else {
    journey = true;
    content = (
      <BrowseStep
        route={route}
        account={account}
        accounts={list}
        snapshots={snapshots.data}
        snapshotId={snapshotId}
        onSnapshot={setSnapshotId}
        configured={configured}
        onChoose={setChoice}
      />
    );
  }

  return (
    <main tabIndex={-1}>
      <h1>{T.title}</h1>
      {journey && <Steps steps={RESTORE_STEPS} current={stepOf(step)} titleRef={titleRef} />}
      {journey && <AuditReminder />}
      {content}
    </main>
  );
}
