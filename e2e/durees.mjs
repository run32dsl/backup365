import { appendFileSync } from 'node:fs';

/** Seuil d'alerte de `pnpm run captures`, en secondes (CONTRIBUTING.md, « Durées de la CI »). */
export const CAPTURES_ALERT_SECONDS = 300;

/**
 * Ligne de relevé de la durée des captures, au format stable `captures : durée <n> s` pour être
 * retrouvée par `grep` dans une sortie de commande, et dépassement éventuel du seuil d'alerte.
 */
export function capturesDurationReport(ms, count) {
  const seconds = Math.round(ms / 1000);
  const threshold = `seuil d'alerte : ${CAPTURES_ALERT_SECONDS} s`;
  return {
    line: `captures : durée ${seconds} s pour ${count} images (${threshold})`,
    exceeded: ms > CAPTURES_ALERT_SECONDS * 1000,
  };
}

/**
 * Écrit le relevé sur la sortie standard et, sous GitHub Actions, dans le résumé du run. Un
 * dépassement du seuil produit un avertissement, sans faire échouer la commande.
 */
export function reportCapturesDuration(ms, count, env = process.env, log = console.log) {
  const { line, exceeded } = capturesDurationReport(ms, count);
  log(line);
  const alert = exceeded
    ? `captures : seuil d'alerte de ${CAPTURES_ALERT_SECONDS} s dépassé`
    : null;
  if (alert) log(env['GITHUB_ACTIONS'] === 'true' ? `::warning::${alert}` : alert);
  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, `${[line, alert].filter(Boolean).join('\n\n')}\n\n`);
  return { line, exceeded };
}
