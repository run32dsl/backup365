export type PillStatus =
  'compliant' | 'late' | 'failed' | 'running' | 'operational' | 'unconfigured' | 'pending';

const PILLS: Record<PillStatus, { icon: string; label: string; tone: string }> = {
  compliant: { icon: '✔', label: 'À jour', tone: 'ok' },
  late: { icon: '⚠', label: 'En retard', tone: 'warn' },
  failed: { icon: '✖', label: 'En échec', tone: 'err' },
  running: { icon: '↻', label: 'En cours', tone: 'info' },
  operational: { icon: '✔', label: 'Opérationnelle', tone: 'ok' },
  unconfigured: { icon: '⚠', label: 'Non configurée', tone: 'warn' },
  pending: { icon: '◷', label: 'En attente', tone: 'neutral' },
};

/** Pastille d'état : icône et texte, jamais la couleur seule. `label` remplace le libellé par défaut. */
export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  const pill = PILLS[status];
  return (
    <span className={`badge badge-${pill.tone}`}>
      <span aria-hidden="true">{pill.icon}</span> {label ?? pill.label}
    </span>
  );
}
