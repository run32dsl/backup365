/**
 * Message en français de chaque code d'erreur métier de l'API : ce qui s'est passé et quoi faire.
 * Les écrans peuvent en surcharger un par un texte plus précis.
 */
export const API_ERRORS: Record<string, string> = {
  backup_not_configured:
    'Sauvegarde non configurée. Les identifiants Microsoft 365 se renseignent sur le serveur (fichiers de secrets). Voir la documentation d’installation, section « Exécution des plans ».',
  audit_unavailable:
    'Journal d’audit indisponible : l’action est refusée tant qu’elle ne peut pas être tracée. Réessayez plus tard ou prévenez un administrateur.',
  search_unavailable:
    'Recherche indisponible : l’index des mails n’est pas prêt. Réessayez dans quelques minutes.',
  content_unavailable:
    'Contenu des mails indisponible : le stockage des sauvegardes ne répond pas. Réessayez plus tard ou prévenez un administrateur.',
  catalog_unavailable:
    'Aucune sauvegarde accessible : le stockage n’est pas configuré ou ne répond pas. Prévenez un administrateur.',
  auth_unavailable:
    'Base des comptes indisponible : connexion impossible pour le moment. Prévenez un administrateur.',
  plans_unavailable:
    'Base des plans indisponible : les plans ne peuvent pas être lus ni modifiés. Prévenez un administrateur.',
  scheduler_unavailable:
    'Planificateur indisponible : aucune sauvegarde ne peut être lancée. Prévenez un administrateur.',
  items_unavailable:
    'Impossible de lister les éléments à sauvegarder : le tenant ne répond pas. Réessayez plus tard.',
  restore_unavailable:
    'Restauration non configurée : aucun tenant n’est relié avec des droits en écriture. Prévenez un administrateur.',
  index_unavailable: 'Index indisponible. Réessayez dans quelques minutes.',
  internal_error: 'Erreur du serveur. Réessayez ; si elle persiste, prévenez un administrateur.',
};

/** Échec à afficher : le message, et de quoi le retrouver dans les journaux. */
export type Problem = { message: string; code?: string; requestId?: string };

/** Texte de repli : jamais un numéro d'erreur seul. */
export function fallbackMessage(status: number): string {
  return `La demande a échoué (HTTP ${status}). Réessayez ; si l’erreur persiste, prévenez un administrateur en lui donnant l’identifiant de requête.`;
}

/** Échec d'une lecture : porte l'identifiant de la requête pour l'afficher à l'écran. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(`HTTP ${status}`);
  }
}

/** Erreur à lever pour une réponse non 2xx. */
export const requestError = (res: Response): RequestError =>
  new RequestError(res.status, res.headers.get('x-request-id') ?? undefined);

/** Identifiant de requête d'une erreur levée par `fetchPlans` ou `fetchAccounts`, s'il y en a un. */
export const requestIdOf = (e: unknown): string | undefined =>
  e instanceof RequestError ? e.requestId : undefined;

export interface Failure {
  message: string;
  /** Code d'erreur métier renvoyé par le serveur, `''` s'il n'y en a pas. */
  code: string;
  /** Identifiant de la requête (en-tête `x-request-id`), à donner au support. */
  requestId?: string;
}

/**
 * Lit une réponse d'erreur : le message le plus précis (`overrides`, puis `API_ERRORS`, puis le
 * texte de repli), le code métier et l'identifiant de requête.
 */
export async function readFailure(
  res: Response,
  overrides: Record<string, string> = {},
): Promise<Failure> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown } | null;
  const code = typeof body?.error === 'string' ? body.error : '';
  const requestId = res.headers.get('x-request-id') ?? undefined;
  return {
    message: overrides[code] ?? API_ERRORS[code] ?? fallbackMessage(res.status),
    code,
    ...(requestId ? { requestId } : {}),
  };
}
