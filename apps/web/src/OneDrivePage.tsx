import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ONEDRIVE_MESSAGES as T,
  fetchAccounts,
  fetchDriveRestoreConfigured,
  fetchSnapshots,
  type DriveJob,
  type DriveSnapshot,
  type Loaded,
  type OneDriveRoute,
} from './onedrive.js';
import { RESTORE_STEPS, RestoreReminders, stepOf } from './RestoreJourney.js';
import { BrowseStep } from './onedrive/BrowseStep.js';
import { ConfirmStep } from './onedrive/ConfirmStep.js';
import { Problem } from './onedrive/Problem.js';
import { TrackStep } from './onedrive/TrackStep.js';
import type { Choice } from './onedrive/types.js';
import { ReasonStep } from './restore/ReasonStep.js';
import { useAdmin } from './role.js';
import { useRestoreBlocked } from './StorageBlocked.js';
import { RestoreSourceNav, Steps } from './ui/index.js';

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
  // Stockage bloqué, quel que soit le rôle : l'étape « Motif » ne garde que « Précédent » (#614).
  const admin = useAdmin();
  const blocked = useRestoreBlocked(true);

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

  const backupAt =
    snapshots?.status === 'ok'
      ? (snapshots.data.find((s) => s.id === (choice?.snapshotId ?? snapshotId))?.createdAt ?? null)
      : null;
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
        backupAt={backupAt}
        job={job}
        onJob={setJob}
        onAgain={reset}
        onRetry={() => {
          setJob(null);
        }}
      />
    );
  } else if (choice && reason !== null && !blocked) {
    journey = true;
    content = (
      <ConfirmStep
        account={account}
        choice={choice}
        backupAt={backupAt}
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
        blocked={blocked}
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
      <RestoreSourceNav current="onedrive" />
      {journey && !job && (
        <Steps steps={RESTORE_STEPS} current={stepOf(step)} titleRef={titleRef} />
      )}
      {journey && !job && <RestoreReminders blocked={blocked} admin={admin} />}
      {content}
    </main>
  );
}
