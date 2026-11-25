import { useId } from 'react';
import { cardSummary, dateTimeOrDash } from '../format.js';
import { oneDriveHash, sizeOf, type DriveEntry, type DriveVersion } from '../onedrive.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import { Button, DataTable } from '../ui/index.js';

/** Liste des éléments d'un dossier sauvegardé : le bouton radio porte le nom de l'élément. */
export function EntriesTable({
  account,
  rows,
  selected,
  pickedVersion = null,
  emptyMessage,
  onSelect,
  onVersions,
}: {
  account: string;
  rows: DriveEntry[];
  selected: string | null;
  /** Version choisie dans la boîte « Versions » : remplace la date de la ligne cochée. */
  pickedVersion?: DriveVersion | null;
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
      onRowClick={(e) => {
        onSelect(e.path);
      }}
      columns={[
        {
          header: 'Nom',
          className: 'card-title',
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
        {
          header: RESTORE_LABELS.versionAt,
          className: 'card-hidden',
          cell: (e) =>
            e.kind === 'folder'
              ? '—'
              : dateTimeOrDash(
                  pickedVersion && selected === e.path ? pickedVersion.at : e.versionAt,
                ),
        },
        {
          header: 'Taille',
          className: 'card-hidden',
          cell: (e) => {
            const size =
              pickedVersion && selected === e.path ? pickedVersion.sizeBytes : e.sizeBytes;
            return size === null ? '—' : sizeOf(size);
          },
        },
        {
          header: 'Détail',
          className: 'card-only',
          cell: (e) =>
            e.kind === 'folder'
              ? null
              : cardSummary(
                  pickedVersion && selected === e.path ? pickedVersion.at : e.versionAt,
                  pickedVersion && selected === e.path ? pickedVersion.sizeBytes : e.sizeBytes,
                ),
        },
        {
          header: 'Versions',
          className: 'card-action',
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
              <span className="table-only">—</span>
            ),
        },
      ]}
    />
  );
}
