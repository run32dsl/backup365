import { planCompliance } from '@backup365/core';
import type { StoredPlan, StoredRun } from './sqlite/sqlite-plan-store.js';
import type { ReportFrequency } from './sqlite/sqlite-report-store.js';

/** Un mail prêt à partir : texte brut, sans pièce jointe. */
export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

/** Ce que contient un rapport : des compteurs, des durées et l'état des plans, rien d'autre. */
export interface ReportSummary {
  plans: { total: number; compliant: number; late: number; failed: number };
  runs: number;
  failures: number;
  /** Taille des données protégées par les exécutions réussies de la période, en octets. */
  volumeBytes: number;
  durationMs: number;
  perPlan: {
    name: string;
    state: 'compliant' | 'late' | 'failed';
    runs: number;
    failures: number;
  }[];
}

const STATE_LABELS = { compliant: 'à jour', late: 'en retard', failed: 'en échec' } as const;

const PERIOD_MS: Record<ReportFrequency, number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };

const number = (value: number, digits = 0): string =>
  value.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** `12,4 Go`, `830 Mo`, `0 o` : unités décimales, comme le reste de la console. */
export function volumeText(bytes: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${number(value, unit >= 3 ? 1 : 0)} ${units[unit]}`;
}

/** `38 min`, `2 h 05 min`, `moins d'1 min`. */
export function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'moins d’1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** `jj/mm/aaaa hh:mm` en UTC. */
export function utcText(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

/** Compte les plans par état et les exécutions commencées dans la période qui finit à `now`. */
export function summarize(
  plans: readonly StoredPlan[],
  runsOf: (planId: string) => readonly StoredRun[],
  now: Date,
  frequency: ReportFrequency,
): ReportSummary {
  const since = now.getTime() - PERIOD_MS[frequency];
  const summary: ReportSummary = {
    plans: { total: plans.length, compliant: 0, late: 0, failed: 0 },
    runs: 0,
    failures: 0,
    volumeBytes: 0,
    durationMs: 0,
    perPlan: [],
  };
  for (const plan of plans) {
    const all = runsOf(plan.id);
    const state = planCompliance(plan.rpoHours, all, now).state;
    summary.plans[state] += 1;
    const inPeriod = all.filter((r) => r.status !== 'running' && Date.parse(r.startedAt) >= since);
    const failures = inPeriod.filter((r) => r.status === 'failed').length;
    summary.runs += inPeriod.length;
    summary.failures += failures;
    // Volume : taille de la dernière sauvegarde réussie de chaque élément, pas la somme des
    // exécutions (un plan horaire compterait 24 fois la même boîte). Liste du plus récent au plus ancien.
    const sized = new Set<string>();
    for (const run of inPeriod) {
      summary.durationMs += run.durationMs ?? 0;
      if (run.status !== 'success' || run.sourceBytes === null || sized.has(run.itemId)) continue;
      sized.add(run.itemId);
      summary.volumeBytes += run.sourceBytes;
    }
    summary.perPlan.push({ name: plan.name, state, runs: inPeriod.length, failures });
  }
  return summary;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n < 2 ? one : many}`;

/** Corps du rapport : identique pour le rapport périodique et pour l'essai. */
export function reportText(summary: ReportSummary, now: Date, frequency: ReportFrequency): string {
  const period = frequency === 'weekly' ? 'des 7 derniers jours' : 'des dernières 24 heures';
  const { plans } = summary;
  const lines = [
    `Rapport de sauvegarde backup365 ${period}, arrêté le ${utcText(now)} UTC.`,
    '',
    plans.total === 0
      ? 'Aucun plan de protection : le rapport est vide.'
      : `Plans : ${plans.compliant} à jour · ${plans.late} en retard · ${plans.failed} en échec`,
    `Exécutions : ${summary.runs}, dont ${plural(summary.failures, 'échec', 'échecs')}`,
    `Volume sauvegardé : ${volumeText(summary.volumeBytes)} · Durée : ${durationText(summary.durationMs)}`,
  ];
  if (summary.perPlan.length > 0) {
    lines.push('', 'Par plan de protection :');
    for (const p of summary.perPlan) {
      lines.push(
        `- ${p.name} : ${STATE_LABELS[p.state]} · ${plural(p.runs, 'exécution', 'exécutions')} · ${plural(p.failures, 'échec', 'échecs')}`,
      );
    }
  }
  lines.push(
    '',
    'Ce rapport ne contient que des compteurs, des durées et l’état des plans.',
    'Le détail est dans la console, page Activités.',
  );
  return lines.join('\n');
}

export function reportSubject(frequency: ReportFrequency): string {
  return `backup365 : rapport ${frequency === 'weekly' ? 'de la semaine' : 'du jour'}`;
}

/** Alerte d'échec : le nom du plan et le nombre d'éléments, jamais l'élément lui-même. */
export function alertMessage(
  failed: readonly { planName: string; startedAt: string; finishedAt: string | null }[],
  to: string[],
): MailMessage {
  const byPlan = new Map<string, number>();
  for (const run of failed) byPlan.set(run.planName, (byPlan.get(run.planName) ?? 0) + 1);
  const latestMs = Math.max(...failed.map((r) => Date.parse(r.finishedAt ?? r.startedAt)));
  const when = Number.isFinite(latestMs) ? ` (dernier à ${utcText(new Date(latestMs))} UTC)` : '';
  const lines = [
    `${plural(failed.length, 'élément en échec', 'éléments en échec')} de sauvegarde${when}.`,
    '',
    ...[...byPlan].map(
      ([name, n]) => `- ${name} : ${plural(n, 'élément en échec', 'éléments en échec')}`,
    ),
    '',
    'La cause est affichée dans la console, page Activités.',
  ];
  const [first] = byPlan.keys();
  return {
    to,
    subject:
      byPlan.size === 1
        ? `backup365 : échec du plan « ${first} »`
        : 'backup365 : échecs de sauvegarde',
    text: lines.join('\n'),
  };
}
