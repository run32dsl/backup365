/** RPO autorisés, en heures. */
export const RPO_HOURS = [4, 12, 24] as const;
export type RpoHours = (typeof RPO_HOURS)[number];
export const DEFAULT_RPO_HOURS: RpoHours = 24;

export type PlanScope = 'all' | 'selection';

/**
 * Charges qu'un plan protège, dans l'ordre de l'accueil (ADR 0011). Le SDK ne sépare pas le
 * calendrier ni les contacts de la boîte : ils suivent « mail ».
 */
export const DATA_TYPES = ['mail', 'onedrive', 'sharepoint'] as const;
export type DataType = (typeof DATA_TYPES)[number];

export interface ProtectionPlanInput {
  name: string;
  scope: PlanScope;
  /** Types de données protégés : au moins un, sans doublon, dans l'ordre de `DATA_TYPES`. */
  dataTypes: DataType[];
  /** Identifiants des éléments (boîtes, sites) ; vide si `scope` vaut `all`. */
  selection: string[];
  rpoHours: RpoHours;
  /** RTO cible, en heures : indicatif, jamais mesuré ni garanti. `null` si non renseigné. */
  rtoHours: number | null;
  retentionDays: number;
  /** Finalité et base légale de la conservation (RGPD) : obligatoire. */
  gdprJustification: string;
}

export type PlanParseResult =
  { ok: true; plan: ProtectionPlanInput } | { ok: false; errors: string[] };

const NAME_MAX = 100;
const JUSTIFICATION_MAX = 1000;
const RETENTION_MAX_DAYS = 3650;
const RTO_MAX_HOURS = 720;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Valide une entrée venue de l'extérieur ; les messages ne reprennent jamais la valeur reçue. */
export function parseProtectionPlanInput(raw: unknown): PlanParseResult {
  if (!isRecord(raw)) return { ok: false, errors: ['Le plan doit être un objet.'] };
  const errors: string[] = [];

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '' || name.length > NAME_MAX) {
    errors.push('Le nom est obligatoire (' + NAME_MAX + ' caractères au plus).');
  }

  const scope = raw.scope;
  if (scope !== 'all' && scope !== 'selection') {
    errors.push('Le périmètre doit être « all » ou « selection ».');
  }

  let selection: string[] = [];
  if (raw.selection !== undefined) {
    if (
      Array.isArray(raw.selection) &&
      raw.selection.every((id): id is string => typeof id === 'string' && id.trim() !== '')
    ) {
      selection = [...new Set(raw.selection.map((id) => id.trim()))];
    } else {
      errors.push('La sélection doit être une liste d’identifiants non vides.');
    }
  }
  if (scope === 'selection' && selection.length === 0) {
    errors.push('Un périmètre « selection » exige au moins un élément.');
  }
  if (scope === 'all' && selection.length > 0) {
    errors.push('Un périmètre « all » n’accepte pas de sélection.');
  }

  let dataTypes: DataType[] = [...DATA_TYPES];
  if (raw.dataTypes !== undefined) {
    const given = raw.dataTypes;
    if (
      Array.isArray(given) &&
      given.length > 0 &&
      given.every((t) => DATA_TYPES.some((d) => d === t))
    ) {
      dataTypes = DATA_TYPES.filter((d) => given.includes(d));
    } else {
      errors.push('Les types de données doivent être pris parmi ' + DATA_TYPES.join(', ') + '.');
    }
  }

  const rpo = raw.rpoHours === undefined ? DEFAULT_RPO_HOURS : raw.rpoHours;
  if (!RPO_HOURS.some((h) => h === rpo)) {
    errors.push('Le RPO doit valoir ' + RPO_HOURS.join(', ') + ' heures.');
  }

  const rto = raw.rtoHours ?? null;
  if (rto !== null && !isIntegerInRange(rto, 1, RTO_MAX_HOURS)) {
    errors.push('Le RTO cible, s’il est renseigné, va de 1 à ' + RTO_MAX_HOURS + ' heures.');
  }

  if (!isIntegerInRange(raw.retentionDays, 1, RETENTION_MAX_DAYS)) {
    errors.push('La durée de conservation va de 1 à ' + RETENTION_MAX_DAYS + ' jours.');
  }

  const justification =
    typeof raw.gdprJustification === 'string' ? raw.gdprJustification.trim() : '';
  if (justification === '' || justification.length > JUSTIFICATION_MAX) {
    errors.push(
      'La justification RGPD est obligatoire (' + JUSTIFICATION_MAX + ' caractères au plus).',
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      name,
      scope: scope as PlanScope,
      dataTypes,
      selection,
      rpoHours: rpo as RpoHours,
      rtoHours: rto as number | null,
      retentionDays: raw.retentionDays as number,
      gdprJustification: justification,
    },
  };
}

const MINUTE_MS = 60_000;

/** Intervalle entre deux exécutions : RPO / 2, en minutes. */
export function runIntervalMinutes(rpoHours: RpoHours): number {
  return rpoHours * 30;
}

/** Hachage FNV-1a 32 bits : stable d'un processus et d'une version à l'autre. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Décalage du plan dans son intervalle, en minutes entières : étale les plans sans état. */
export function staggerOffsetMinutes(planId: string, rpoHours: RpoHours): number {
  return fnv1a(planId) % runIntervalMinutes(rpoHours);
}

/** Fenêtre de nuit des plans à RPO long (ADR 0017), en heure locale du serveur. */
export const NIGHT_WINDOW = { startHour: 22, endHour: 6 } as const;
/** RPO à partir duquel un plan est planifié dans la fenêtre de nuit. */
export const NIGHT_MIN_RPO_HOURS = 24;
/** Deux passages par nuit, espacés de 4 h : le second reprend un échec du premier. */
const NIGHT_SLOT_GAP_MINUTES = 240;
/** Décalage maximal du premier passage : le second reste avant 6 h, même au changement d'heure. */
const NIGHT_STAGGER_MINUTES = 180;

/** Vrai si les passages du plan tombent dans la fenêtre de nuit. */
export function isNightPlan(rpoHours: number): boolean {
  return rpoHours >= NIGHT_MIN_RPO_HOURS;
}

/** Ligne de la fiche du plan : la fenêtre utilisée, ou `null` si le plan garde son rythme RPO/2. */
export function scheduleWindowLabel(rpoHours: number): string | null {
  return isNightPlan(rpoHours)
    ? `Sauvegarde planifiée la nuit (${NIGHT_WINDOW.startHour}\u00a0h – ${NIGHT_WINDOW.endHour}\u00a0h)`
    : null;
}

/**
 * Passages d'un plan de nuit autour de `at`, triés. Le premier de chaque nuit est à 22 h locales
 * (heure du serveur) plus un décalage propre au plan, le second 4 h plus tard. L'écart entre
 * deux nuits se mesure en temps réel (23 à 25 h au changement d'heure) : le plus long écart entre
 * deux passages (premier de la nuit suivante moins second) reste de 21 h, sous le RPO de 24 h.
 */
function nightSlots(planId: string, at: Date): number[] {
  const offset = fnv1a(planId) % NIGHT_STAGGER_MINUTES;
  const slots: number[] = [];
  for (let day = -2; day <= 2; day++) {
    const start = new Date(
      at.getFullYear(),
      at.getMonth(),
      at.getDate() + day,
      NIGHT_WINDOW.startHour,
    ).getTime();
    slots.push(start + offset * MINUTE_MS, start + (offset + NIGHT_SLOT_GAP_MINUTES) * MINUTE_MS);
  }
  return slots;
}

type Schedulable = { id: string; rpoHours: RpoHours };

/** Écart entre les deux passages d'une nuit, en minutes. */
export const NIGHT_SLOT_GAP = NIGHT_SLOT_GAP_MINUTES;

/** Début (22 h locales) de la fenêtre de nuit qui contient `at`, ou `null` hors fenêtre. */
export function nightWindowStart(at: Date): Date | null {
  const h = at.getHours();
  if (h >= NIGHT_WINDOW.startHour) {
    return new Date(at.getFullYear(), at.getMonth(), at.getDate(), NIGHT_WINDOW.startHour);
  }
  if (h < NIGHT_WINDOW.endHour) {
    return new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1, NIGHT_WINDOW.startHour);
  }
  return null;
}

/** Dernier créneau planifié à `at` ou avant. */
export function currentRunSlot(plan: Schedulable, at: Date): Date {
  if (isNightPlan(plan.rpoHours)) {
    const past = nightSlots(plan.id, at).filter((t) => t <= at.getTime());
    return new Date(past[past.length - 1] as number);
  }
  return new Date(nextRunAt(plan, at).getTime() - runIntervalMinutes(plan.rpoHours) * MINUTE_MS);
}

/**
 * Prochaine exécution planifiée strictement après `after`, à la minute près. Hors nuit, les
 * créneaux sont `décalage + k × intervalle` depuis l'époque Unix (UTC) : ils ne dépendent que de
 * l'identifiant du plan et de l'horloge, donc survivent à un redémarrage. Les plans de nuit
 * suivent la fenêtre de nuit du fuseau du serveur.
 */
export function nextRunAt(plan: Schedulable, after: Date): Date {
  if (isNightPlan(plan.rpoHours)) {
    return new Date(nightSlots(plan.id, after).find((t) => t > after.getTime()) as number);
  }
  const interval = runIntervalMinutes(plan.rpoHours);
  const offset = staggerOffsetMinutes(plan.id, plan.rpoHours);
  const afterMinute = Math.floor(after.getTime() / MINUTE_MS);
  const k = Math.floor((afterMinute - offset) / interval) + 1;
  return new Date((offset + k * interval) * MINUTE_MS);
}

export type RunStatus = 'running' | 'success' | 'failed';

export interface PlanRun {
  startedAt: string;
  /** `null` tant que l'exécution tourne. */
  finishedAt: string | null;
  status: RunStatus;
  /**
   * Motif pour lequel une exécution réussie n'a créé aucun point de restauration : la ressource
   * ne contenait rien à sauvegarder. `null` ou absent : un point de restauration existe.
   */
  noSnapshotReason?: NoSnapshotReason | null;
}

/**
 * Causes d'échec exposées à l'interface : liste fermée, jamais le code ni le message du SDK. Le
 * libellé français de chaque cause est écrit dans l'interface.
 */
export const FAILURE_CAUSES = ['interrupted', 'backup_errors', 'no_result', 'unknown'] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

/** Cause (liste fermée) d'un code d'erreur enregistré ; `unknown` pour tout autre code. */
export function failureCauseOf(code: string | null | undefined): FailureCause {
  return FAILURE_CAUSES.find((c) => c === code && c !== 'unknown') ?? 'unknown';
}

/** Seul motif noté : `no_changes` laisse le point de restauration précédent valable. */
export type NoSnapshotReason = 'no_content';

/** `compliant` : conforme ; `late` : en retard ; `failed` : en échec. */
export type ComplianceState = 'compliant' | 'late' | 'failed';

export interface Compliance {
  state: ComplianceState;
  /** Fin de la dernière exécution réussie ; `null` s'il n'y en a aucune. */
  lastSuccessAt: string | null;
}

/** Une fin située dans le futur (horloge décalée) ne prouve rien : elle n'est pas « récente ». */
function isFresh(ageMs: number, rpoHours: RpoHours): boolean {
  return ageMs >= 0 && ageMs < rpoHours * 3_600_000;
}

/**
 * Conforme si la dernière exécution réussie finit depuis moins que le RPO. Sinon « en échec » si
 * l'exécution la plus récente a échoué, « en retard » dans les autres cas (y compris sans aucune
 * exécution : rien n'est protégé). Une date illisible ne compte pas comme une réussite.
 * Une réussite `no_content` compte : il n'y avait rien à protéger. Le dernier point de
 * restauration ne se lit pas ici (liste d'exécutions bornée) mais dans le magasin des plans.
 */
export function planCompliance(
  rpoHours: RpoHours,
  runs: readonly PlanRun[],
  now: Date,
): Compliance {
  let lastSuccess: { at: string; ms: number } | null = null;
  let latest: { run: PlanRun; ms: number } | null = null;
  for (const run of runs) {
    const startMs = Date.parse(run.startedAt);
    if (!Number.isNaN(startMs) && (latest === null || startMs > latest.ms)) {
      latest = { run, ms: startMs };
    }
    if (run.status !== 'success' || run.finishedAt === null) continue;
    const endMs = Date.parse(run.finishedAt);
    if (!Number.isNaN(endMs) && (lastSuccess === null || endMs > lastSuccess.ms)) {
      lastSuccess = { at: run.finishedAt, ms: endMs };
    }
  }
  const lastSuccessAt = lastSuccess?.at ?? null;
  if (lastSuccess !== null && isFresh(now.getTime() - lastSuccess.ms, rpoHours)) {
    return { state: 'compliant', lastSuccessAt };
  }
  return { state: latest?.run.status === 'failed' ? 'failed' : 'late', lastSuccessAt };
}

export interface PlanComplianceEntry extends Compliance {
  id: string;
  name: string;
  rpoHours: RpoHours;
}

/** Conformité des plans pour le tableau de bord : décompte par état et plans non conformes. */
export interface PlanComplianceReport {
  counts: Record<ComplianceState, number>;
  /** Plans « en retard » ou « en échec », dans l'ordre reçu. */
  nonCompliant: PlanComplianceEntry[];
}

export function buildPlanComplianceReport(
  plans: readonly { id: string; name: string; rpoHours: RpoHours }[],
  runsOf: (planId: string) => readonly PlanRun[],
  now: Date,
): PlanComplianceReport {
  const counts: Record<ComplianceState, number> = { compliant: 0, late: 0, failed: 0 };
  const nonCompliant: PlanComplianceEntry[] = [];
  for (const plan of plans) {
    const compliance = planCompliance(plan.rpoHours, runsOf(plan.id), now);
    counts[compliance.state] += 1;
    if (compliance.state !== 'compliant') {
      nonCompliant.push({ id: plan.id, name: plan.name, rpoHours: plan.rpoHours, ...compliance });
    }
  }
  return { counts, nonCompliant };
}
