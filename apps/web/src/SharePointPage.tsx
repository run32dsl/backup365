import type { DriveSnapshot } from '@backup365/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Loaded } from './onedrive.js';
import { AuditReminder, RESTORE_STEPS, stepOf } from './RestoreJourney.js';
import { ReasonStep } from './restore/ReasonStep.js';
import {
  SHAREPOINT_MESSAGES as T,
  fetchSiteRestoreConfigured,
  fetchSiteSnapshots,
  fetchSites,
  type Site,
  type SiteJob,
  type SharePointRoute,
} from './sharepoint.js';
import { ChooseStep } from './sharepoint/ChooseStep.js';
import { ConfirmStep } from './sharepoint/ConfirmStep.js';
import { Problem } from './sharepoint/Problem.js';
import { SiteDenied } from './sharepoint/SiteDenied.js';
import { TrackStep } from './sharepoint/TrackStep.js';
import type { Choice } from './sharepoint/types.js';
import { EmptyState, RestoreSourceNav, Steps } from './ui/index.js';

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
      <RestoreSourceNav current="sharepoint" />
      {journey && !job && (
        <Steps steps={RESTORE_STEPS} current={stepOf(step)} titleRef={titleRef} />
      )}
      {journey && !direct && !job && <AuditReminder />}
      {content}
    </main>
  );
}
