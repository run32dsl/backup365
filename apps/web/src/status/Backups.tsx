import { useState } from 'react';
import type { ComplianceState, StatusReport } from '@backup365/core';
import { searchHref } from '../mail.js';
import { dateTimeOrDash, ageLabel, workloadLabel } from '../format.js';
import { Button, DataTable, type Column } from '../ui/index.js';
import { Counts } from './Counts.js';
import { STATE_COMPLIANCE, StateBadge, serviceOf, sortRows, type Row } from './model.js';
import { unprotectedServices } from './Services.js';

/** Ce qui est sauvegardé, avec les noms de la navigation : un site est un « Site SharePoint ». */
function contentLabel(r: Row): string {
  return r.kind === 'site' ? 'Site SharePoint' : workloadLabel(r.workload);
}

const COLUMNS: Column<Row>[] = [
  {
    header: 'Source',
    cell: (r) =>
      r.state !== 'ok' && r.kind === 'mailbox' && r.workload === 'mail' ? (
        <a href={searchHref(r.sourceId)}>{r.displayName}</a>
      ) : (
        r.displayName
      ),
  },
  { header: 'Contenu', cell: contentLabel, className: 'nowrap' },
  { header: 'Dernière sauvegarde (UTC)', cell: (r) => dateTimeOrDash(r.lastSnapshotAt) },
  { header: 'Ancienneté', cell: (r) => ageLabel(r.ageHours) },
  { header: 'État', cell: (r) => <StateBadge state={r.state} /> },
];

/** Sauvegardes : décompte par état, puis le tableau trié ; sous 900 px, les lignes à jour sont repliées. */
export function Backups({ report }: { report: StatusReport }) {
  const [showOk, setShowOk] = useState(false);
  // Une source sans plan n'a pas de ligne « À jour » : rien ne garantit qu'elle le reste.
  const unprotected = unprotectedServices(report);
  const rows = sortRows(
    report.rows.filter((r) => r.state !== 'ok' || !unprotected.includes(serviceOf(r))),
  );
  const okCount = rows.filter((r) => r.state === 'ok').length;
  const counts: Record<ComplianceState, number> = { compliant: okCount, late: 0, failed: 0 };
  for (const r of rows) if (r.state !== 'ok') counts[STATE_COMPLIANCE[r.state]]++;
  return (
    <section className="status-section" aria-labelledby="backups-title">
      <h2 id="backups-title">Sauvegardes</h2>
      <p className="help">{`Une sauvegarde est en retard au-delà de ${report.maxAgeHours} h.`}</p>
      <Counts counts={counts} />
      <div className={showOk ? 'backups show-ok' : 'backups'}>
        <DataTable
          caption="État par source et par contenu"
          hideCaption
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => `${r.kind}/${r.sourceId}/${r.workload}`}
          rowClassName={(r) => (r.state === 'ok' ? 'row-ok' : undefined)}
          empty={{
            message:
              report.rows.length > 0
                ? 'Aucune sauvegarde à afficher : les sources sans plan ne sont pas listées comme à jour.'
                : 'Aucune boîte ni site sauvegardé.',
          }}
        />
        {okCount > 0 && (
          <Button
            variant="secondary"
            className="ok-toggle"
            aria-expanded={showOk}
            onClick={() => setShowOk(!showOk)}
          >
            {showOk
              ? 'Masquer les sauvegardes à jour'
              : `Afficher ${okCount < 2 ? 'la sauvegarde' : `les ${okCount} sauvegardes`} à jour`}
          </Button>
        )}
      </div>
    </section>
  );
}
