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
  if (reason.startsWith('outcome=')) return restoreLabel(reason);
  const free = /(?:^|;)reason=(.*)$/s.exec(reason);
  if (free) return free[1]?.trim() ?? '';
  // Code système inconnu (snake_case, sans espace) : omis. Sinon, justification saisie telle quelle.
  return /^[a-z0-9]+(?:[_.:,-][a-z0-9]+)+$/.test(reason) ? '' : reason.trim();
}

const OUTCOME_LABELS: Record<string, string> = { succeeded: 'Réussie', failed: 'Échouée' };
const MODE_LABELS: Record<string, string> = { copy: 'copie', replace: 'remplacement' };
const RESTORE_SCOPE_LABELS: Record<string, string> = {
  library: 'bibliothèque',
  site: 'site entier',
};

/** Résultat d'une restauration (`outcome=…;duration_ms=…;…;reason=<texte>`) : fait d'audit, traduit. */
function restoreLabel(reason: string): string {
  const at = reason.indexOf(';reason=');
  const head = at < 0 ? reason : reason.slice(0, at);
  const free = at < 0 ? '' : reason.slice(at + ';reason='.length).trim();
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
  return [parts.join(', '), free].filter(Boolean).join(' : ');
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
