import type { DriveSnapshot } from '@backup365/core';
import { useId, useState } from 'react';
import { RestoreNotConfigured } from '../RestoreAction.js';
import { RESTORE_BUTTONS as B } from '../RestoreJourney.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import {
  continueHint,
  dateTimeOf,
  scopeOfKind,
  selectionLabel,
  sharePointHash,
  type Site,
  type SiteScope,
} from '../sharepoint.js';
import { Button, WizardActions } from '../ui/index.js';
import { ContentTree } from './ContentTree.js';
import type { Choice, Selected } from './types.js';

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
  const [whole, setWhole] = useState(initialScope === 'site' && admin);
  const [path, setPath] = useState(initialPath);
  const [selected, setSelected] = useState<Selected | null>(null);
  const hintId = useId();
  const notConfiguredId = useId();
  const ok = whole || selected !== null;
  const scope: SiteScope = whole ? 'site' : scopeOfKind(selected?.kind ?? 'file');
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
              window.location.hash = sharePointHash(e.currentTarget.value);
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
              setSelected(null);
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

      {admin && (
        <div className="choice-item">
          <label className="choice">
            <input
              type="checkbox"
              checked={whole}
              onChange={(e) => {
                setWhole(e.currentTarget.checked);
              }}
            />
            Restaurer le site entier
          </label>
        </div>
      )}

      {whole ? (
        <p>Tout le contenu de « {site.displayName} » sera concerné.</p>
      ) : (
        <ContentTree
          key={snapshotId}
          siteId={site.id}
          siteName={site.displayName}
          snapshotId={snapshotId}
          path={path}
          selected={selected}
          onPath={setPath}
          onSelect={setSelected}
        />
      )}

      <p aria-live="polite">
        {whole
          ? 'Sélection : le site entier'
          : selected
            ? `Sélection : ${selectionLabel(selected)}`
            : null}
      </p>
      {!ok && (
        <p id={hintId} className="field-help">
          {continueHint()}
        </p>
      )}
      <WizardActions>
        <Button
          aria-disabled={blocked || undefined}
          className={blocked ? 'is-inactive' : undefined}
          aria-describedby={!configured ? notConfiguredId : !ok ? hintId : undefined}
          onClick={() => {
            if (!blocked && point) {
              onContinue({
                scope,
                path: whole ? '/' : (selected?.path ?? '/'),
                snapshotId,
                pointAt: point.createdAt,
              });
            }
          }}
        >
          {B.next}
        </Button>
      </WizardActions>
      {!configured && <RestoreNotConfigured id={notConfiguredId} />}
    </>
  );
}
