import type {
  ComplianceState,
  DataType,
  FailureCause,
  NoSnapshotReason,
  PlanScope,
  RpoHours,
  RunStatus,
} from '@backup365/core';

/**
 * Plan tel que `GET /api/plans` le rend : le plan, sa conformité et sa dernière exécution. Les
 * trois champs optionnels ne sont envoyés qu'à un administrateur : un opérateur ne reçoit ni
 * sélection, ni délai de remise en service, ni justification. Tout code partagé par les deux
 * rôles doit donc s'en passer.
 */
export interface PlanItem {
  id: string;
  name: string;
  scope: PlanScope;
  dataTypes: DataType[];
  selection?: string[];
  rpoHours: RpoHours;
  rtoHours?: number | null;
  retentionDays: number;
  gdprJustification?: string;
  createdAt: string;
  compliance: {
    state: ComplianceState;
    lastSuccessAt: string | null;
    lastRestorePointAt: string | null;
  };
  running: boolean;
  /** Lancement manuel en file derrière la sauvegarde en cours : ni échec, ni exécution. */
  queued?: boolean;
  lastRun: {
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    noSnapshotReason: NoSnapshotReason | null;
    /** Cause de l'échec, d'une liste fermée ; absente si la dernière exécution n'a pas échoué. */
    failureCause?: FailureCause;
  } | null;
}

export interface Mailbox {
  id: string;
  displayName: string;
}

// ---- Libellés -------------------------------------------------------------------------------

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  mail: 'Messagerie',
  contacts: 'Contacts',
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
};

/** Aide sous « Messagerie » : le SDK ne sépare pas le calendrier de la boîte. */
export const MAIL_HELP = 'avec le calendrier';
/** Aide sous « Contacts », une charge à part depuis le SDK 7.2.0 (issue #543). */
export const CONTACTS_HELP = 'Copie les contacts des boîtes couvertes par ce plan.';

export const RPO_CHOICES: readonly RpoHours[] = [4, 12, 24];
export const RTO_CHOICES: readonly number[] = [8, 24, 72];
/** Durées de conservation proposées, en jours. */
export const RETENTION_CHOICES: readonly number[] = [180, 365, 1095];

/**
 * Les choix proposés, plus la valeur courante si elle n'en fait pas partie (plan créé par l'API),
 * en ordre croissant.
 */
export function withCurrent(choices: readonly number[], current: number): number[] {
  const all = choices.includes(current) ? [...choices] : [...choices, current];
  return all.sort((a, b) => a - b);
}

/** Espace insécable : la valeur et son unité ne se séparent pas à la coupure de ligne. */
export const NBSP = '\xa0';

/** Durée en heures, en toutes lettres (« 1 heure », « 24 heures »). */
export function hoursLabel(hours: number): string {
  return `${hours}${NBSP}heure${hours === 1 ? '' : 's'}`;
}

export function retentionLabel(days: number): string {
  if (days === 180) return `6${NBSP}mois`;
  if (days === 365) return `1${NBSP}an`;
  if (days % 365 === 0) return `${days / 365}${NBSP}ans`;
  return `${days}${NBSP}jour${days === 1 ? '' : 's'}`;
}

/** Aide et exemple du champ « Justification de cette durée ». */
export const JUSTIFICATION_HELP =
  'Les durées longues doivent rester justifiées au regard du RGPD. N’y saisissez pas de donnée personnelle.';
export const JUSTIFICATION_PLACEHOLDER = 'Obligation légale : courriers 1 an';

export const MESSAGES = {
  loading: 'Chargement des plans…',
  loadError: 'Impossible de charger les plans.',
  forbidden: 'Action réservée aux administrateurs.',
  readOnly: 'Lecture seule : seul un administrateur peut modifier les plans.',
  emptyTitle: 'Aucun plan de protection',
  emptyAdmin: 'Vos données Microsoft 365 ne sont pas protégées.',
  emptyOperator: 'Aucun plan n’a encore été créé par un administrateur.',
  notConfigured: 'Sauvegarde non configurée',
  notConfiguredHelp: 'Connectez d’abord Microsoft 365 pour créer un plan.',
  notConfiguredOperator: 'Demandez à un administrateur de la configurer',
  name: 'Saisissez un nom pour le plan.',
  nameTaken: 'Ce nom est déjà utilisé. Choisissez-en un autre.',
  dataTypes: 'Choisissez au moins un élément à protéger.',
  selection: 'Choisissez au moins un élément à protéger.',
  justification: 'Indiquez pourquoi cette durée est nécessaire.',
  runReason: 'Indiquez un motif pour continuer.',
  updated: 'Plan modifié.',
  deleted: 'Plan supprimé.',
  runStarted: 'Sauvegarde lancée. Motif enregistré au journal d’audit.',
  running: 'En cours',
  queued: 'En file d’attente',
  runBusy: 'Sauvegarde déjà en cours',
  runAlreadyQueued: 'Déjà en file d’attente',
} as const;

/** Cause d'un échec en une phrase, sans code ni détail technique. */
export const FAILURE_LABELS: Record<FailureCause, string> = {
  interrupted: 'Sauvegarde interrompue',
  backup_errors: 'Des dossiers n’ont pas pu être sauvegardés',
  no_result: 'Aucune donnée n’a été sauvegardée',
  unknown: 'Cause non précisée',
};
