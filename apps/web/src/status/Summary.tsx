import { effectiveState, type BackupState, type StatusReport } from '@backup365/core';
import { plural, workloadLabel } from '../format.js';
import { PLANS_HASH } from '../plans.js';
import { Alert } from '../ui/index.js';
import { unprotectedServices } from './Services.js';
import { CONDITIONAL_WRITES } from './StorageCheck.js';

/** Liste française : « A », « A et B », « A, B et C ». */
const joinFr = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;

/**
 * Bandeau de synthèse : « mes sauvegardes vont-elles bien ? »
 * Titre : les deux problèmes les plus graves (le détail est dans les pastilles des sections).
 * Corps : la conduite à tenir, puis les sources sans plan et le stockage à vérifier.
 */
export function Summary({ report }: { report: StatusReport }) {
  const count = (state: BackupState) =>
    report.rows.filter((r) => effectiveState(r) === state).length;
  const plans = report.plans ?? null;
  const planFailed = plans?.counts.failed ?? 0;
  const planLate = plans?.counts.late ?? 0;
  const failed = count('missing');
  const stale = count('stale');
  // Du plus grave au moins grave.
  const issues = (
    [
      [planFailed, 'plan', 'en échec'],
      [failed, 'sauvegarde', 'en échec'],
      [planLate, 'plan', 'en retard'],
      [stale, 'sauvegarde', 'en retard'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, noun, what]) => `${plural(n, noun)} ${what}`);
  const unprotected = unprotectedServices(report);
  // Un stockage sur lequel Atlas refuse d'écrire (SDK 7.3.0) est signalé en tête de page.
  const storage = report.storage?.conditionalWrites === 'ignored';
  const nothing = issues.length === 0 && unprotected.length === 0 && !storage;
  // Pas de « tout est à jour » sans rien à constater, ni quand l'état des plans est inconnu.
  if (nothing && (report.rows.length === 0 || report.plans === null)) return null;
  if (nothing) return <Alert tone="success">Toutes les sauvegardes sont à jour</Alert>;
  const planIssues = planLate + planFailed;
  const title =
    issues.length > 0
      ? joinFr(issues.slice(0, 2))
      : unprotected.length > 0
        ? `${plural(unprotected.length, 'source')} sans plan`
        : CONDITIONAL_WRITES.summaryTitle;
  const sentences: string[] = [];
  if (planIssues > 0)
    sentences.push(
      planIssues > 1
        ? 'Ouvrez les plans concernés pour voir leur dernière exécution.'
        : 'Ouvrez le plan concerné pour voir sa dernière exécution.',
    );
  else if (failed + stale > 0) sentences.push('Les sources concernées sont listées plus bas.');
  if (unprotected.length > 0)
    sentences.push(
      `${joinFr(unprotected.map(workloadLabel))} ${unprotected.length > 1 ? 'n’ont' : 'n’a'} aucun plan de protection.`,
    );
  if (storage)
    sentences.push(
      title === CONDITIONAL_WRITES.summaryTitle
        ? CONDITIONAL_WRITES.summaryAlone
        : CONDITIONAL_WRITES.summary,
    );
  return (
    <Alert
      tone={failed > 0 || planFailed > 0 ? 'error' : 'warning'}
      title={title}
      action={
        planIssues > 0 ? (
          <a className="alert-link" href={PLANS_HASH}>
            Voir les plans de protection
          </a>
        ) : undefined
      }
    >
      {sentences.join(' ')}
    </Alert>
  );
}
