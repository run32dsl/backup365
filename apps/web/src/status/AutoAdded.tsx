import type { AutoAddedEntry, StatusReport } from '@backup365/core';
import { dateTimeOf } from '../format.js';
import { PLANS_HASH } from '../plans.js';
import { Alert, DataTable, EmptyState, type Column } from '../ui/index.js';

/** Un élément ajouté, nommé par le catalogue ; sans nom, son identifiant et pourquoi. */
export function addedItemLabel(item: AutoAddedEntry['items'][number]): string {
  return item.name ?? `${item.id} (nom connu après sa première sauvegarde)`;
}

const COLUMNS: Column<AutoAddedEntry>[] = [
  { header: 'Plan', cell: (e) => <a href={PLANS_HASH}>{e.plan}</a>, rowHeader: true },
  { header: 'Exécution (UTC)', cell: (e) => dateTimeOf(e.at), className: 'nowrap' },
  {
    header: 'Ajoutés',
    cell: (e) => (
      <ul className="added-list">
        {e.items.map((item) => (
          <li key={item.id}>{addedItemLabel(item)}</li>
        ))}
      </ul>
    ),
  },
];

/**
 * Comptes, boîtes et sites qu'un plan « toute l'organisation » a pris d'office à sa dernière
 * exécution, parce qu'ils sont apparus dans le tenant depuis (issue #545). Administrateurs.
 */
export function AutoAdded({ report }: { report: StatusReport }) {
  const entries = report.autoAdded;
  if (entries === undefined) return null;
  return (
    <section className="status-section" aria-label="Ajoutés automatiquement">
      <h2>Ajoutés automatiquement</h2>
      {entries === null ? (
        <Alert tone="error">Éléments ajoutés indisponibles</Alert>
      ) : entries.length === 0 ? (
        <EmptyState>
          Aucun compte ni site ajouté à la dernière exécution des plans « toute l’organisation ».
        </EmptyState>
      ) : (
        <DataTable
          caption="Nouveaux comptes et sites pris à la dernière exécution de chaque plan"
          columns={COLUMNS}
          rows={entries}
          rowKey={(e) => e.planId}
          empty={{ message: 'Aucun élément ajouté.' }}
        />
      )}
    </section>
  );
}
