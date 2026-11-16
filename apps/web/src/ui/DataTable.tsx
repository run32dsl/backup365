import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState.js';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

/**
 * Tableau : `<th scope="col">`, légende, et sous 900 px une carte par ligne dont les étiquettes
 * viennent des en-têtes (`data-label`). Les rôles ARIA explicites gardent la sémantique de
 * tableau quand le CSS passe les éléments en `display: block`.
 */
export function DataTable<T>({
  caption,
  hideCaption = false,
  columns,
  rows,
  rowKey,
  empty,
  loading = false,
}: {
  caption: string;
  /** La légende reste lue par les lecteurs d'écran mais n'est pas affichée (le titre la remplace). */
  hideCaption?: boolean;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Phrase de l'état vide, avec au plus une action. */
  empty?: { message: string; action?: ReactNode };
  loading?: boolean;
}) {
  if (loading) return <p role="status">Chargement…</p>;
  if (rows.length === 0 && empty)
    return <EmptyState action={empty.action}>{empty.message}</EmptyState>;
  return (
    <table className="data-table" role="table">
      <caption className={hideCaption ? 'sr-only' : 'table-caption'}>{caption}</caption>
      <thead role="rowgroup">
        <tr role="row">
          {columns.map((c) => (
            <th key={c.header} scope="col" role="columnheader">
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={rowKey(row)} role="row">
            {columns.map((c) => (
              <td key={c.header} role="cell" data-label={c.header}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
