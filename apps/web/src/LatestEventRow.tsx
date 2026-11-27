import { DATA_TYPES } from '@backup365/core';
import {
  RESULT_VIEW,
  causeOf,
  copiedLabel,
  durationLabel,
  mailOnlyTypes,
  sourcesLabel,
  volumeLabel,
  type RunEvent,
  type RunItem,
} from './activities/runs.js';
import { lowerFirst } from './failureText.js';
import { NBSP, dateTimeOf, quoted } from './format.js';
import type { PlanItem } from './plans.js';
import { DATA_TYPE_LABELS } from './plans/model.js';
import { cardLine } from './status/model.js';
import { StatusPill } from './ui/index.js';

const planOf = (run: RunItem, plans: readonly PlanItem[]) => plans.find((p) => p.id === run.planId);

/** Colonne « Type » : ce que le plan protège (« Boîtes mail, OneDrive ») ; `Sauvegarde` à défaut. */
export function runTypeLabel(run: RunItem, plans: readonly PlanItem[]): string {
  const plan = planOf(run, plans);
  const types = DATA_TYPES.filter((t) => plan?.dataTypes?.includes(t));
  return types.length === 0 ? 'Sauvegarde' : types.map((t) => DATA_TYPE_LABELS[t]).join(', ');
}

/** Ce que sauvegarde le plan de l'exécution ; `undefined` si le plan n'est pas connu. */
export const runDataTypes = (run: RunItem, plans: readonly PlanItem[]) =>
  planOf(run, plans)?.dataTypes;

/** Vrai si le plan ne sauvegarde que des boîtes mail : ses sources se comptent en « boîtes ». */
export function mailOnly(run: RunItem, plans: readonly PlanItem[]): boolean {
  return mailOnlyTypes(planOf(run, plans)?.dataTypes);
}

/**
 * Ce qu'a fait une exécution, sans le plan : le nombre de sources, puis les éléments copiés
 * (« 0 » compris), la taille et la durée ; ou « sauvegarde en cours » ; ou la cause d'un échec.
 */
export function runDetails(
  event: RunEvent,
  boxes = false,
  dataTypes?: readonly string[],
): string[] {
  const sources = sourcesLabel(event.runs.length, boxes);
  if (event.result === 'running') return [sources, 'sauvegarde en cours'];
  // Seule la cause est reprise ici, identique pour tous les rôles.
  const cause = causeOf(event, true, dataTypes);
  if (cause) return [sources, `cause${NBSP}: ${lowerFirst(cause.cause)}`];
  const parts = [
    sources,
    copiedLabel(event.itemsSaved ?? 0),
    volumeLabel(event.sourceBytes) ?? '',
    event.durationMs === null ? '' : durationLabel(event.durationMs),
  ];
  return parts.filter(Boolean);
}

/** Colonne « Résumé » : le plan puis ce qu'a fait l'exécution. */
export function runSummary(event: RunEvent, boxes = false, dataTypes?: readonly string[]): string {
  return [quoted(event.planName), ...runDetails(event, boxes, dataTypes)].join(' · ');
}

/**
 * Une ligne de « Derniers événements » : Heure, Type, Statut, Résumé en tableau. Sous 900 px,
 * carte titrée comme Activités : le nom du plan seul, la pastille dessous, puis
 * « type · heure UTC · détails » (colonnes `table-only` masquées).
 */
export function LatestEventRow({
  run,
  type,
  boxes,
  dataTypes,
}: {
  run: RunEvent;
  type: string;
  /** Le plan ne sauvegarde que des boîtes mail : « 5 boîtes » plutôt que « 5 sources ». */
  boxes: boolean;
  /** Ce que sauvegarde le plan : la cause d'un échec nomme ce qui manque (#632). */
  dataTypes?: readonly string[];
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
        <span className="table-summary">{runSummary(run, boxes, dataTypes)}</span>
        <span className="card-only">{run.planName}</span>
        <span className="card-only card-pill">{pill}</span>
        <span className="card-only cell-secondary">
          {cardLine([type, at === '' ? '' : `${at} UTC`, ...runDetails(run, boxes, dataTypes)])}
        </span>
      </td>
    </tr>
  );
}
