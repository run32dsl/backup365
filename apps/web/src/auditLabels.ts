import { shortDate } from './plans.js';

/** Libellé français des ressources du journal ; une ressource inconnue reste générique. */
export const RESOURCE_LABELS: Record<string, string> = {
  auth: 'Connexion',
  session: 'Connexion',
  account: 'Compte',
  accounts: 'Comptes',
  plan: 'Plan de protection',
  plans: 'Plans de protection',
  mailboxes: 'Boîtes',
  mail: 'Mail',
  'mail.search': 'Recherche de mails',
  'mail.export': 'Export de mail',
  'mail.restore': 'Restauration de mail',
  snapshot: 'Sauvegarde',
  catalog: 'Catalogue',
  onedrive: 'OneDrive',
  'onedrive.items': 'Fichiers OneDrive',
  'onedrive.versions': 'Versions OneDrive',
  'onedrive.restore': 'Restauration OneDrive',
  sharepoint: 'SharePoint',
  'sharepoint.items': 'Éléments SharePoint',
  'sharepoint.scope': 'Périmètre SharePoint',
  'sharepoint.restore': 'Restauration SharePoint',
};

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? 'Autre ressource';
}

const REASON_LABELS: Record<string, string> = {
  forbidden: 'Accès refusé',
  admin_required: 'Réservé aux administrateurs',
  bad_credentials: 'Identifiants incorrects',
  locked: 'Compte verrouillé',
  disabled: 'Compte désactivé',
  oidc: 'Compte Microsoft',
  first_admin: 'Premier administrateur',
  password_changed: 'Mot de passe changé',
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
  rpoHours: 'RPO',
  rtoHours: 'RTO',
  retentionDays: 'rétention',
  gdprJustification: 'justification RGPD',
};

const SCOPE_LABELS: Record<string, string> = {
  all: 'toute l’organisation',
  selection: 'sélection',
};

/**
 * Motif lisible d'une entrée : motif système traduit, justification saisie par l'utilisateur
 * conservée telle quelle (`…;reason=<texte>`), valeur inconnue omise (chaîne vide).
 */
export function reasonLabel(reason: string | undefined): string {
  if (!reason) return '';
  const known = REASON_LABELS[reason];
  if (known) return known;
  const created = /^scope:(\w+),rpo:(\d+)$/.exec(reason);
  if (created) {
    const scope = SCOPE_LABELS[created[1] ?? ''] ?? created[1];
    return `Création : ${scope}, RPO ${created[2]} h`;
  }
  if (reason.startsWith('changed:')) {
    const fields = reason
      .slice('changed:'.length)
      .split(',')
      .map((f) => FIELD_LABELS[f])
      .filter(Boolean);
    return fields.length > 0 ? `Modifié : ${fields.join(', ')}` : '';
  }
  const free = /(?:^|;)reason=(.*)$/s.exec(reason);
  return free?.[1]?.trim() ?? '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cible lisible : un identifiant de plan devient son nom (ou « Plan supprimé »), un autre UUID est omis. */
export function targetLabel(
  target: string | undefined,
  resource: string,
  planNames: ReadonlyMap<string, string> | null,
): string {
  if (!target) return '';
  const name = planNames?.get(target);
  if (name) return name;
  if (UUID.test(target)) return planNames && resource === 'plan' ? 'Plan supprimé' : '';
  return target;
}

/** Date courte (`14/11 06:00`) ; l'horodatage complet reste dans l'infobulle. */
export const auditDate = shortDate;
