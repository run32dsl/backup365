import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState.js';

export interface Column<T> {
  /** Identifiant stable de la colonne, indépendant du libellé (`mailbox`) : sert à la retrouver ou à la retirer. */
  key?: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Classe CSS ajoutée à l'en-tête et à chaque cellule de la colonne (`nowrap`, `keep-words`, `address`, `num`, `card-hidden`, `card-wide`, `card-action`, `card-title`, `card-only`, `card-nolabel`, `col-mailbox`). */
  className?: string;
  /** La cellule nomme la ligne : `<th scope="row">` au lieu de `<td>`. */
  rowHeader?: boolean;
}

const CONTROLS = 'a,button,input,label,select,textarea,summary';

/** Un clic sur une carte sélectionne la ligne, sauf s'il tombe sur un contrôle qui a son propre rôle. */
export function isCardClick(target: { closest?: (selector: string) => unknown } | null): boolean {
  return !target?.closest?.(CONTROLS);
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
  rowClassName,
  onRowClick,
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
  /** Classe CSS ajoutée à une ligne. */
  rowClassName?: (row: T) => string | undefined;
  /** Rend la ligne (la carte en mobile) cliquable ; les liens, boutons et champs gardent leur action. */
  onRowClick?: (row: T) => void;
}) {
  if (loading) return <p role="status">Chargement…</p>;
  if (rows.length === 0 && empty)
    return <EmptyState action={empty.action}>{empty.message}</EmptyState>;
  return (
    <table className="data-table" role="table">
      <caption className={hideCaption ? 'sr-only' : 'table-caption'}>{caption}</caption>
      <thead role="rowgroup">
        <tr role="row">
          {columns.map((c, i) => (
            <th key={i} scope="col" role="columnheader" className={c.className}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            role="row"
            className={
              [rowClassName?.(row), onRowClick && 'row-clickable'].filter(Boolean).join(' ') ||
              undefined
            }
            onClick={
              onRowClick
                ? (ev) => {
                    if (isCardClick(ev.target as Element)) onRowClick(row);
                  }
                : undefined
            }
          >
            {columns.map((c, i) =>
              c.rowHeader ? (
                <th key={i} scope="row" role="rowheader" className={c.className}>
                  {c.cell(row)}
                </th>
              ) : (
                <td key={i} role="cell" data-label={c.header} className={c.className}>
                  {c.cell(row)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
