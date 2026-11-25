import { useEffect, useState } from 'react';
import {
  ONEDRIVE_MESSAGES as T,
  dateTimeOf,
  fetchVersions,
  sizeOf,
  type DriveEntry,
  type DriveVersion,
  type Loaded,
} from '../onedrive.js';
import { Button, Dialog } from '../ui/index.js';
import { Problem } from './Problem.js';

/** Panneau des versions d'un fichier : une seule choisie, la restauration vient après le motif. */
export function VersionsDialog({
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
      <p className="field-help">
        La version choisie sera restaurée après le motif et la confirmation.
      </p>
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
              {dateTimeOf(v.at)} UTC · {sizeOf(v.sizeBytes)}
              {v.current ? ' (la plus récente)' : ''}
            </label>
          ))}
        </fieldset>
      )}
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onClose}>
          Fermer
        </Button>
        <Button
          disabled={rows.length === 0}
          onClick={() => {
            const chosen = rows[picked];
            if (chosen) onChoose(chosen);
          }}
        >
          Choisir cette version
        </Button>
      </div>
    </Dialog>
  );
}
