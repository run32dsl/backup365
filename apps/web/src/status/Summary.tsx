import { effectiveState, type BackupState, type StatusReport } from '@backup365/core';
import { plural, workloadLabel } from '../format.js';
import { PLANS_HASH } from '../plans.js';
import { Alert } from '../ui/index.js';
import { unprotectedServices } from './Services.js';
import { CONDITIONAL_WRITES } from './StorageCheck.js';

/** Bandeau de synthèse : « mes sauvegardes vont-elles bien ? » */
export function Summary({ report }: { report: StatusReport }) {
  const count = (state: BackupState) =>
    report.rows.filter((r) => effectiveState(r) === state).length;
  const plans = report.plans ?? null;
  const parts: [number, string, string][] = [
    [count('stale'), 'sauvegarde', 'en retard'],
    [count('missing'), 'sauvegarde', 'en échec'],
    [plans?.counts.late ?? 0, 'plan', 'en retard'],
    [plans?.counts.failed ?? 0, 'plan', 'en échec'],
  ];
  const unprotected = unprotectedServices(report);
  const extra =
    unprotected.length === 0
      ? []
      : [
          `${plural(unprotected.length, 'source')} sans plan (${unprotected.map(workloadLabel).join(', ')})`,
        ];
  // Un stockage qui laisse une restauration écraser une sauvegarde est signalé en tête de page.
  if (report.storage?.conditionalWrites === 'ignored') extra.push(CONDITIONAL_WRITES.summary);
  const shown = parts.filter(([n]) => n > 0);
  const nothing = shown.length === 0 && extra.length === 0;
  // Pas de « tout est à jour » sans rien à constater, ni quand l'état des plans est inconnu.
  if (nothing && (report.rows.length === 0 || report.plans === null)) return null;
  if (nothing) return <Alert tone="success">Toutes les sauvegardes sont à jour</Alert>;
  const planIssues = (plans?.counts.late ?? 0) + (plans?.counts.failed ?? 0);
  const severe = count('missing') > 0 || (plans?.counts.failed ?? 0) > 0;
  const text = [...shown.map(([n, noun, what]) => `${plural(n, noun)} ${what}`), ...extra].join(
    ', ',
  );
  return (
    <Alert tone={severe ? 'error' : 'warning'}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
      {planIssues > 0 && (
        <>
          {' '}
          <a href={PLANS_HASH}>Voir les plans de protection</a>
        </>
      )}
    </Alert>
  );
}
