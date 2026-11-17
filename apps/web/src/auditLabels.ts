import { dateTimeOf } from './format.js';

const REASON_LABELS: Record<string, string> = {
  forbidden: 'Accès refusé',
  admin_required: 'Réservé aux administrateurs',
  bad_credentials: 'Identifiants incorrects',
  locked: 'Compte verrouillé',
  disabled: 'Compte désactivé',
  oidc: 'Compte Microsoft',
  first_admin: 'Premier administrateur',
  password_changed: 'Mot de passe changé',
  password_reset: 'Mot de passe réinitialisé',
  'role:admin': 'Rôle administrateur',
  unchanged: 'Aucun changement',
  catalog_unavailable: 'Catalogue indisponible',
  index_unavailable: 'Index indisponible',
  snapshot_not_found: 'Sauvegarde introuvable',
  not_found: 'Introuvable',
  mail_not_found: 'Mail introuvable',
  item_not_found: 'Élément introuvable',
  content_unavailable: 'Contenu indisponible',
  content_not_found: 'Contenu introuvable',
  content_unsupported: 'Contenu non pris en charge',
  confirmation_mismatch: 'Confirmation incorrecte',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'nom',
  scope: 'périmètre',
  dataTypes: 'types de données',
  selection: 'sélection',
  rpoHours: 'fréquence de sauvegarde',
  rtoHours: 'délai de reprise',
  retentionDays: 'rétention',
  gdprJustification: 'justification RGPD',
};

const SCOPE_LABELS: Record<string, string> = {
  all: 'toute l’organisation',
  selection: 'sélection',
};

const CREATED = /^scope:(\w+),rpo:(\d+)$/;
const RESET_PREFIX = 'password_reset: ';
/** Codes émis par le serveur hors de `REASON_LABELS` : `oidc_<code>`, `password_change_*`, changements de compte. */
const SYSTEM_CODE =
  /^(?:oidc_(?:invalid_request|provider_error|invalid_token|no_group|account_conflict|disabled|unavailable)|password_change_(?:locked|failed)|(?:role:(?:admin|operator)|disabled:(?:true|false))(?:,disabled:(?:true|false))?)$/;

/** Sépare un motif `…;reason=<texte>` : la partie écrite par le système, et le texte saisi. */
function splitReason(reason: string): { system: string; typed: string } {
  const at = reason.indexOf(';reason=');
  if (at >= 0) return { system: reason.slice(0, at), typed: reason.slice(at + 8).trim() };
  if (reason.startsWith('reason=')) return { system: '', typed: reason.slice(7).trim() };
  if (reason.startsWith(RESET_PREFIX)) {
    return { system: 'password_reset', typed: reason.slice(RESET_PREFIX.length).trim() };
  }
  return { system: reason, typed: '' };
}

/** Vrai si le texte est un code ou un résumé que le serveur émet (liste fermée), et non saisi. */
function isSystemReason(text: string): boolean {
  return (
    text in REASON_LABELS ||
    CREATED.test(text) ||
    text.startsWith('changed:') ||
    text.startsWith('outcome=') ||
    SYSTEM_CODE.test(text)
  );
}

/** Motif de l'entrée : uniquement le texte saisi par l'utilisateur, conservé tel quel. */
export function reasonLabel(reason: string | undefined): string {
  if (!reason) return '';
  const { system, typed } = splitReason(reason);
  if (typed) return typed;
  return isSystemReason(system) || system !== reason ? '' : reason.trim();
}

/**
 * Précision écrite par le système (« Compte Microsoft », « Accès refusé », résumé d'un plan ou
 * d'une restauration), affichée sous l'action ; chaîne vide quand l'entrée n'en a pas.
 */
export function detailLabel(reason: string | undefined): string {
  if (!reason) return '';
  const { system } = splitReason(reason);
  const known = REASON_LABELS[system];
  if (known) return known;
  const created = CREATED.exec(system);
  if (created) {
    const scope = SCOPE_LABELS[created[1] ?? ''] ?? created[1];
    return `Création : ${scope}, sauvegarde toutes les ${created[2]} h`;
  }
  if (system.startsWith('changed:')) {
    const fields = system
      .slice('changed:'.length)
      .split(',')
      .map((f) => FIELD_LABELS[f])
      .filter(Boolean);
    return fields.length > 0 ? `Modifié : ${fields.join(', ')}` : '';
  }
  return system.startsWith('outcome=') ? restoreLabel(system) : '';
}

const OUTCOME_LABELS: Record<string, string> = { succeeded: 'Réussie', failed: 'Échouée' };
const MODE_LABELS: Record<string, string> = { copy: 'copie', replace: 'remplacement' };
const RESTORE_SCOPE_LABELS: Record<string, string> = {
  library: 'bibliothèque',
  site: 'site entier',
};

/** Résultat d'une restauration (`outcome=…;duration_ms=…;…`) : fait d'audit, traduit. */
function restoreLabel(head: string): string {
  const fields = new Map<string, string>();
  for (const pair of head.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const parts: string[] = [];
  const outcome = OUTCOME_LABELS[fields.get('outcome') ?? ''];
  if (outcome) parts.push(outcome);
  const duration = fields.get('duration_ms');
  if (duration !== undefined && /^\d+$/.test(duration)) {
    const ms = Number(duration);
    parts.push(ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);
  }
  const mode = MODE_LABELS[fields.get('mode') ?? ''];
  if (mode) parts.push(mode);
  const scope = RESTORE_SCOPE_LABELS[fields.get('scope') ?? ''];
  if (scope) parts.push(scope);
  const skipped = fields.get('skipped');
  if (skipped !== undefined && /^\d+$/.test(skipped)) parts.push(`${skipped} conservés`);
  const errors = fields.get('errors');
  if (errors !== undefined && /^\d+$/.test(errors)) parts.push(`${errors} erreurs`);
  return parts.join(', ');
}

/** Ce que le journal sait de la cible d'une entrée ; l'API ajoute l'objet et la boîte d'un mail. */
export interface TargetInfo {
  resource: string;
  target?: string;
  targetName?: string;
  targetMailbox?: string;
}

/**
 * Cible lisible : un nom, et pour un mail la boîte en texte secondaire. Jamais un identifiant
 * interne : mail ou plan introuvable → « Élément supprimé » / « Plan supprimé », sinon « — ».
 */
export function targetView(
  e: TargetInfo,
  planNames: ReadonlyMap<string, string> | null,
): { name: string; secondary?: string } {
  if (!e.target) return { name: '—' };
  if (e.resource === 'plan') {
    return { name: planNames?.get(e.target) ?? (planNames ? 'Plan supprimé' : '—') };
  }
  if (e.resource === 'mail' || e.resource === 'mail.restore') {
    return e.targetName
      ? { name: e.targetName, ...(e.targetMailbox ? { secondary: e.targetMailbox } : {}) }
      : { name: 'Élément supprimé' };
  }
  // Seul l'identifiant de connexion d'un compte se lit tel quel.
  return { name: e.resource === 'account' ? e.target : '—' };
}

/** Acteur lisible : l'auteur d'une requête sans session s'écrit « Inconnu ». */
export const actorLabel = (actor: string): string => (actor === 'anonymous' ? 'Inconnu' : actor);

/** Date complète (`14/11/2026 06:00`, UTC) ; l'horodatage ISO reste dans l'infobulle. */
export const auditDate = dateTimeOf;
