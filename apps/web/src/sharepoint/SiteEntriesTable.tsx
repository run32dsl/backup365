import { cardSummary, dateTimeOrDash } from '../format.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import { breadcrumbLink, sizeOf, type SiteEntry } from '../sharepoint.js';
import { DataTable } from '../ui/index.js';
import { LINK_SCOPE, selectionOf, type Selected } from './types.js';

/** Liste d'un niveau du site : même présentation que celle d'OneDrive (`EntriesTable`). */
export function SiteEntriesTable({
  siteId,
  rows,
  selected,
  onOpen,
  onSelect,
}: {
  siteId: string;
  rows: SiteEntry[];
  selected: Selected | null;
  onOpen: (path: string) => void;
  onSelect: (selected: Selected) => void;
}) {
  return (
    <div className="drive-list">
      <DataTable
        caption="Contenu du site sauvegardé"
        hideCaption
        rows={rows}
        rowKey={(e) => e.path}
        onRowClick={(e) => {
          onSelect(selectionOf(e));
        }}
        columns={[
          {
            header: 'Nom',
            className: 'card-title',
            cell: (e) => (
              <span className="choice">
                <input
                  type="radio"
                  name="selection"
                  aria-label={e.name}
                  checked={selected?.path === e.path}
                  onChange={() => {
                    onSelect(selectionOf(e));
                  }}
                />
                {e.kind === 'file' ? (
                  e.name
                ) : (
                  <>
                    <a {...breadcrumbLink({ path: e.path }, siteId, LINK_SCOPE, onOpen)}>
                      {e.name}
                    </a>
                    <span className="cell-secondary-inline">
                      {e.kind === 'library' ? 'bibliothèque' : 'dossier'}
                    </span>
                  </>
                )}
              </span>
            ),
          },
          {
            header: RESTORE_LABELS.versionAt,
            className: 'card-hidden',
            cell: (e) => (e.kind === 'file' ? dateTimeOrDash(e.versionAt) : '—'),
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
