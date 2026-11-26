import { useState } from 'react';
import { effectiveState, type ComplianceState, type StatusReport } from '@backup365/core';
import { searchHref } from '../mail.js';
import { dateTimeOf, dateTimeOrDash, ageLabel, workloadLabel } from '../format.js';
import { Address, Button, DataTable, type Column } from '../ui/index.js';
import { Counts } from './Counts.js';
import { STATE_COMPLIANCE, StateBadge, cardLine, serviceOf, sortRows, type Row } from './model.js';
import { unprotectedServices } from './Services.js';

/** Ce qui est sauvegardé, avec les noms de la navigation : un site est un « Site SharePoint ». */
function contentLabel(r: Row): string {
  return r.kind === 'site' ? 'Site SharePoint' : workloadLabel(r.workload);
}

/** Ligne secondaire d'une source dont un plan a échoué : le plan, la date, et qui la couvre. */
export function failureNote(r: Row): string | undefined {
  if (!r.failure) return undefined;
  const head = `Plan « ${r.failure.plan} » : échec le ${dateTimeOf(r.failure.at)} UTC`;
  const by = r.failure.coveredBy;
  return by ? `${head} · dernière réussite par « ${by.plan} » le ${dateTimeOf(by.at)} UTC` : head;
}

const COLUMNS: Column<Row>[] = [
  {
    header: 'Source',
    className: 'card-title address',
    cell: (r) =>
      effectiveState(r) !== 'ok' && r.kind === 'mailbox' && r.workload === 'mail' ? (
        <a href={searchHref(r.sourceId)}>
          <Address value={r.displayName} />
        </a>
      ) : (
        <Address value={r.displayName} />
      ),
  },
  { header: 'Contenu', cell: contentLabel, className: 'nowrap card-hidden' },
  {
    header: 'Dernière sauvegarde (UTC)',
    className: 'card-hidden',
    cell: (r) => dateTimeOrDash(r.lastSnapshotAt),
  },
  { header: 'Ancienneté', className: 'nowrap card-hidden', cell: (r) => ageLabel(r.ageHours) },
  {
    header: 'État',
    className: 'card-nolabel',
    cell: (r) => {
      const note = failureNote(r);
      return (
        <div>
          <StateBadge state={effectiveState(r)} />
          {note && <small className="state-note">{note}</small>}
        </div>
      );
    },
  },
  // Sous 900 px seulement : « OneDrive · 21/11/2026 11:46 UTC · il y a 3 jours ».
  {
    header: 'Détail',
    className: 'card-only',
    cell: (r) => {
      const at = dateTimeOf(r.lastSnapshotAt);
      return cardLine([contentLabel(r), at === '' ? '' : `${at} UTC`, ageLabel(r.ageHours)]);
    },
  },
];

/** Sauvegardes : décompte par état, puis le tableau trié ; sous 900 px, les lignes à jour sont repliées. */
export function Backups({ report }: { report: StatusReport }) {
  const [showOk, setShowOk] = useState(false);
  // Une source sans plan n'a pas de ligne « À jour » : rien ne garantit qu'elle le reste.
  const unprotected = unprotectedServices(report);
  const rows = sortRows(
    report.rows.filter((r) => effectiveState(r) !== 'ok' || !unprotected.includes(serviceOf(r))),
  );
  const okCount = rows.filter((r) => effectiveState(r) === 'ok').length;
  const counts: Record<ComplianceState, number> = { compliant: okCount, late: 0, failed: 0 };
  for (const r of rows)
    if (effectiveState(r) !== 'ok') counts[STATE_COMPLIANCE[effectiveState(r)]]++;
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
          rowClassName={(r) => (effectiveState(r) === 'ok' ? 'row-ok' : undefined)}
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
