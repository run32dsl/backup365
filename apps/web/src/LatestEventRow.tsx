import { RESULT_VIEW, type RunItem } from './activities/runs.js';
import { dateTimeOf } from './format.js';
import { cardLine } from './status/model.js';
import { StatusPill } from './ui/index.js';

/**
 * Une ligne de « Derniers événements » : Heure, Type, Statut, Résumé en tableau. Sous 900 px,
 * carte titrée : le résumé, la pastille, puis « type · heure UTC » (colonnes `table-only` masquées).
 */
export function LatestEventRow({
  run,
  type,
  summary,
}: {
  run: RunItem;
  type: string;
  summary: string;
}) {
  const at = dateTimeOf(run.startedAt);
  const pill = <StatusPill {...RESULT_VIEW[run.result]} />;
  return (
    <tr>
      <td className="table-only">
        <time dateTime={run.startedAt}>{`${at || '—'} UTC`}</time>
      </td>
      <td className="table-only">{type}</td>
      <td className="table-only">{pill}</td>
      <td className="card-title">
        {summary}
        <span className="card-only"> {pill}</span>
        <span className="card-only cell-secondary">
          {cardLine([type, at === '' ? '' : `${at} UTC`])}
        </span>
      </td>
    </tr>
  );
}
