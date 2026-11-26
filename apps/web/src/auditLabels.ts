import type { AuditAction } from '@backup365/core';
import { dateTimeOf, dayOf, elementsInError, elementsWhich, plural } from './format.js';

export const ACTION_LABELS: Record<AuditAction, string> = {
  'list.view': 'Consultation d’une liste',
  'item.open': 'Ouverture d’une fiche',
  'item.export': 'Export',
  'access.denied': 'Échec d’accès',
  'auth.login': 'Connexion',
  'auth.login_failed': 'Échec de connexion',
  'auth.logout': 'Déconnexion',
  'account.create': 'Création de compte',
  'account.update': 'Modification de compte',
  'plan.create': 'Création de plan',
  'plan.update': 'Modification de plan',
  'plan.delete': 'Suppression de plan',
  'plan.run': 'Lancement manuel d’un plan',
  'restore.request': 'Demande de restauration',
  'restore.result': 'Résultat de restauration',
  'settings.update': 'Modification des réglages',
  'report.test': 'Essai de rapport par mail',
};

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
  backup_not_configured: 'Sauvegarde non configurée',
  scheduler_unavailable: 'Planificateur indisponible',
  items_unavailable: 'Éléments indisponibles',
  run_in_progress: 'Sauvegarde déjà en cours',
  no_items: 'Aucun élément à sauvegarder',
  reason_required: 'Motif absent',
  invalid_plan: 'Plan invalide',
  plan_name_taken: 'Nom de plan déjà pris',
  plan_not_found: 'Plan introuvable',
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
    text.startsWith('from=') ||
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
  if (system.startsWith('from=')) return transferLabel(fieldsOf(system));
  return system.startsWith('outcome=') ? restoreLabel(system) : '';
}

const OUTCOME_LABELS: Record<string, string> = { succeeded: 'Réussie', failed: 'Échouée' };
const MODE_LABELS: Record<string, string> = { copy: 'copie', replace: 'remplacement' };
const RESTORE_SCOPE_LABELS: Record<string, string> = {
  library: 'bibliothèque',
  site: 'site entier',
};

/** Champs `clé=valeur` séparés par `;` d'un motif écrit par le système. */
function fieldsOf(head: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const pair of head.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return fields;
}

/** Restauration vers un autre compte (`from=…;to=…`, issue #546) : de qui, vers qui. */
function transferLabel(fields: Map<string, string>): string {
  const from = fields.get('from');
  const to = fields.get('to');
  return from && to ? `Restauration vers un autre compte · de ${from} vers ${to}` : '';
}

/** Résultat d'une restauration (`outcome=…;duration_ms=…;…`) : fait d'audit, traduit. */
function restoreLabel(head: string): string {
  const fields = fieldsOf(head);
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
  if (skipped !== undefined && /^\d+$/.test(skipped) && Number(skipped) > 0) {
    parts.push(elementsWhich(Number(skipped), 'conservé'));
  }
  const errors = fields.get('errors');
  if (errors !== undefined && /^\d+$/.test(errors) && Number(errors) > 0) {
    parts.push(elementsInError(Number(errors)));
  }
  return [parts.join(', '), transferLabel(fields)].filter(Boolean).join(' · ');
}

/** Ce que le journal sait de la cible d'une entrée ; l'API ajoute l'objet et la boîte d'un mail. */
export interface TargetInfo {
  resource: string;
  target?: string;
  targetName?: string;
  targetMailbox?: string;
}

/** Texte de « pas de cible » ; la colonne Cible du journal laisse alors sa cellule vide. */
export const NO_TARGET = '—';

const LIST_SOURCES: Record<string, string> = {
  'mail.search': 'Messagerie',
  'onedrive.items': 'OneDrive',
  'sharepoint.items': 'SharePoint',
  'sharepoint.scope': 'SharePoint',
  audit: 'Journal d’audit',
};

/** Filtres inscrits avec la consultation du journal (`from=…;to=…;action=…`), jamais l'acteur saisi. */
function auditFilters(target: string | undefined): string {
  const f = new Map<string, string>();
  for (const pair of (target ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) f.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const from = dayOf(f.get('from') ?? null);
  // `to` est une borne exclue (lendemain 00:00) : le dernier jour inclus est la veille.
  const toEnd = Date.parse(f.get('to') ?? '');
  const to = Number.isNaN(toEnd) ? '' : dayOf(new Date(toEnd - 1).toISOString());
  const parts: string[] = [];
  if (from && to) parts.push(`du ${from} au ${to}`);
  else if (from) parts.push(`depuis le ${from}`);
  else if (to) parts.push(`jusqu’au ${to}`);
  const action = ACTION_LABELS[(f.get('action') ?? '') as AuditAction];
  if (action) parts.push(`action : ${action}`);
  return parts.length > 0 ? parts.join(', ') : 'sans filtre';
}

/**
 * Cible lisible : un nom, et pour un mail la boîte en texte secondaire. Jamais un identifiant
 * interne : mail ou plan introuvable → « Élément supprimé » / « Plan supprimé », sinon « — ».
 */
export function targetView(
  e: TargetInfo,
  planNames: ReadonlyMap<string, string> | null,
): { name: string; secondary?: string } {
  const list = LIST_SOURCES[e.resource];
  if (list) {
    if (e.resource === 'audit') return { name: list, secondary: auditFilters(e.target) };
    // Consultation d'une liste : la source, puis le compte ou le site ; jamais les termes cherchés.
    const scope = e.resource.startsWith('sharepoint')
      ? e.targetName
      : e.resource === 'onedrive.items'
        ? e.target?.split('/')[0]
        : e.target === '*'
          ? 'toutes les boîtes'
          : e.target; // absent : entrée antérieure ou filtre sans boîte indexée
    return scope ? { name: list, secondary: scope } : { name: list };
  }
  if (!e.target) return { name: NO_TARGET };
  if (e.resource === 'plan') {
    return { name: planNames?.get(e.target) ?? (planNames ? 'Plan supprimé' : NO_TARGET) };
  }
  if (e.resource === 'mail' || e.resource === 'mail.restore') {
    return e.targetName
      ? { name: e.targetName, ...(e.targetMailbox ? { secondary: e.targetMailbox } : {}) }
      : { name: 'Élément supprimé' };
  }
  // Seul l'identifiant de connexion d'un compte se lit tel quel.
  return { name: e.resource === 'account' ? e.target : NO_TARGET };
}

/** Nombre d'éléments d'une entrée avec son unité accordée (« 13 mails », « 0 mail ») ; vide sans nombre. */
export function countLabel(resource: string, count: number | undefined): string {
  if (count === undefined) return '';
  if (resource === 'audit') return plural(count, 'entrée');
  return resource.startsWith('mail') ? plural(count, 'mail') : plural(count, 'élément');
}

/** Acteur lisible : l'auteur d'une requête sans session s'écrit « Inconnu ». */
export const actorLabel = (actor: string): string => (actor === 'anonymous' ? 'Inconnu' : actor);

/** Date complète (`14/11/2026 06:00`, UTC) ; l'horodatage ISO reste dans l'infobulle. */
export const auditDate = dateTimeOf;
