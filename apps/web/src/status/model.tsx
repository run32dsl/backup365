import type { BackupState, ComplianceState, StatusReport } from '@backup365/core';
import { plural } from '../format.js';
import { StatusPill } from '../ui/index.js';

export type Row = StatusReport['rows'][number];

export type ServiceEntry = NonNullable<StatusReport['services']>[number];

/** Mêmes états et mêmes libellés pour les sauvegardes et pour les plans. */
export const STATE_COMPLIANCE: Record<BackupState, ComplianceState> = {
  ok: 'compliant',
  stale: 'late',
  missing: 'failed',
};

export const STATE_LABELS: Record<ComplianceState, string> = {
  compliant: 'À jour',
  late: 'En retard',
  failed: 'En échec',
};

/** Pastille d'état : icône et texte, jamais la couleur seule. */
export function StateBadge({ state }: { state: BackupState }) {
  const status = STATE_COMPLIANCE[state];
  return <StatusPill status={status} label={STATE_LABELS[status]} />;
}

const SEVERITY: Record<BackupState, number> = { missing: 0, stale: 1, ok: 2 };

/** Du pire état au meilleur, puis de la plus ancienne à la plus récente (sans sauvegarde : en premier). */
export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY[a.state] - SEVERITY[b.state] ||
      (b.ageHours ?? Number.POSITIVE_INFINITY) - (a.ageHours ?? Number.POSITIVE_INFINITY),
  );
}

/** Nom des éléments d'un périmètre : la sélection d'un plan désigne des boîtes ou des comptes. */
const SCOPE_UNITS: Record<ServiceEntry['service'], { one: string; all: string } | null> = {
  mail: { one: 'boîte', all: 'Toutes les boîtes' },
  onedrive: { one: 'compte', all: 'Tous les comptes' },
  sharepoint: null,
};

/** `12 boîtes`, `Tous les comptes` ; chaîne vide sans plan. */
export function scopeLabel(s: Pick<ServiceEntry, 'service' | 'scope'>): string {
  if (s.scope === null) return '';
  const unit = SCOPE_UNITS[s.service];
  if (s.scope.kind === 'all') return unit?.all ?? 'Tous les sites';
  return unit
    ? plural(s.scope.count, unit.one)
    : plural(s.scope.count, 'élément choisi', 'éléments choisis');
}

/** Le service d'une ligne du catalogue : un site est toujours SharePoint. */
export function serviceOf(r: Row): ServiceEntry['service'] {
  if (r.kind === 'site') return 'sharepoint';
  return r.workload === 'onedrive' ? 'onedrive' : 'mail';
}

const UNIT_NAMES: Record<ServiceEntry['service'], string> = {
  mail: 'boîte',
  onedrive: 'compte',
  sharepoint: 'site',
};

/** `1 compte sur 5 en retard` ; chaîne vide si aucune source du service n'est en retard. */
export function lateCause(service: ServiceEntry['service'], rows: readonly Row[]): string {
  const own = rows.filter((r) => serviceOf(r) === service);
  const late = own.filter((r) => r.state !== 'ok').length;
  if (late === 0) return '';
  return `${plural(late, UNIT_NAMES[service])} sur ${own.length} en retard`;
}
