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
 * Titre : les deux problèmes les plus graves (le détail est dans les pastilles des sections) ; un
 * stockage bloqué les précède tous, en erreur, et les compteurs passent dans le corps (#612).
 * Corps : la conduite à tenir, puis les sources sans plan.
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
  // Stockage bloqué : la panne passe avant les compteurs, qui deviennent la suite du corps (#612).
  const title = storage
    ? CONDITIONAL_WRITES.ignoredTitle
    : issues.length > 0
      ? joinFr(issues.slice(0, 2))
      : `${plural(unprotected.length, 'source')} sans plan`;
  const sentences: string[] = [];
  if (storage) {
    sentences.push(CONDITIONAL_WRITES.action);
    if (report.rows.length > 0) sentences.push(CONDITIONAL_WRITES.before);
    if (issues.length > 0) sentences.push(`${joinFr(issues)}.`);
  }
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
  return (
    <Alert
      tone={storage || failed > 0 || planFailed > 0 ? 'error' : 'warning'}
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
