import { useEffect, useId, useRef, useState } from 'react';
import {
  ONEDRIVE_MESSAGES as T,
  breadcrumbOf,
  dateTimeOf,
  dayOf,
  fetchEntries,
  oneDriveHash,
  type DriveEntry,
  type DriveSnapshot,
  type DriveVersion,
  type Loaded,
  type OneDriveRoute,
} from '../onedrive.js';
import { RestoreNotConfigured } from '../RestoreAction.js';
import { RESTORE_BUTTONS as B } from '../RestoreJourney.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import { selectionLabel } from '../selection.js';
import { Button, WizardActions } from '../ui/index.js';
import { EntriesTable } from './EntriesTable.js';
import { Problem } from './Problem.js';
import { VersionsDialog } from './VersionsDialog.js';
import type { Choice } from './types.js';

/** Étape 1 : parcourir la sauvegarde et choisir un élément. */
export function BrowseStep({
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
  const [pickedVersion, setPickedVersion] = useState<DriveVersion | null>(null);
  const [versionsOf, setVersionsOf] = useState<DriveEntry | null>(null);
  const [attempt, setAttempt] = useState(0);
  const versionsButton = useRef<HTMLButtonElement | null>(null);
  const hintId = useId();
  const chooseHintId = useId();
  const path = route.path;

  useEffect(() => {
    let current = true;
    setEntries(null);
    setSelected(null);
    setPickedVersion(null);
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

  const rootLabel = accounts.find((a) => a.id === account)?.displayName ?? account;
  const crumbs = breadcrumbOf(path, rootLabel);

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
          <label htmlFor="od-snapshot">{RESTORE_LABELS.backupDate}</label>
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
      <nav aria-label="Fil d'Ariane">
        <ol className="breadcrumb">
          {crumbs.map((c, i, all) => (
            <li key={c.path}>
              {i === all.length - 1 ? (
                <span aria-current="location">{c.label}</span>
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
            <legend className="sr-only">Éléments de {crumbs.at(-1)?.label}</legend>
            <EntriesTable
              account={account}
              rows={rows}
              selected={selected}
              emptyMessage={`Ce dossier est vide dans la sauvegarde du ${dayOf(snapshot?.createdAt ?? null)}.`}
              pickedVersion={pickedVersion}
              onSelect={(p) => {
                if (p === selected) return;
                setSelected(p);
                setPickedVersion(null);
              }}
              onVersions={(entry, button) => {
                versionsButton.current = button;
                setVersionsOf(entry);
              }}
            />
          </fieldset>
        )}
      </div>

      <p aria-live="polite">
        {chosen
          ? selectionLabel({
              name: chosen.name,
              kind: chosen.kind,
              versionAt: pickedVersion ? dateTimeOf(pickedVersion.at) : null,
            })
          : null}
      </p>
      {!chosen && (
        <p id={chooseHintId} className="field-help">
          Cochez un fichier ou un dossier pour continuer.
        </p>
      )}
      <WizardActions>
        <Button
          aria-disabled={!configured || !chosen || undefined}
          className={!configured || !chosen ? 'is-inactive' : undefined}
          aria-describedby={
            [!chosen && chooseHintId, !configured && hintId].filter(Boolean).join(' ') || undefined
          }
          onClick={() => {
            if (configured && chosen)
              onChoose(
                pickedVersion
                  ? { entry: chosen, snapshotId: pickedVersion.snapshotId, version: pickedVersion }
                  : { entry: chosen, snapshotId },
              );
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
            setSelected(versionsOf.path);
            setPickedVersion(version);
            setVersionsOf(null);
          }}
        />
      )}
    </>
  );
}
