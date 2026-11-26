import { Alert } from './ui/index.js';
import { NNBSP, dateTimeOf, quoted } from './format.js';

/** Conduite à tenir après l'échec d'une restauration : la même pour la messagerie, OneDrive et SharePoint. */
export const RESTORE_FAILURE_ADVICE =
  'Réessayez ; si l’échec se répète, prévenez l’exploitant du serveur avec l’heure ci-dessus.';

/** Échec d'une restauration, tel que le serveur le rend ; `restore_lost` : suivi perdu. */
export type RestoreError =
  | 'restore_error'
  | 'restore_unreachable'
  | 'restore_lost'
  | 'restore_busy'
  | 'restore_denied'
  | 'restore_storage';

/**
 * Cause des refus apportés par le SDK 7.2.0 (issue #567), la même pour les trois parcours ;
 * `null` pour les autres échecs, que chaque parcours nomme à sa façon.
 */
export function sdkRefusalCause(error: RestoreError | null, subject: string): string | null {
  if (error === 'restore_busy')
    return `une autre opération est en cours sur ${subject} (une sauvegarde, par exemple)${NNBSP}; attendez quelques minutes`;
  if (error === 'restore_denied')
    return `Microsoft 365 a refusé l’accès${NNBSP}: vérifiez les autorisations accordées à l’application`;
  if (error === 'restore_storage')
    return 'le stockage des sauvegardes ne répond pas pour le moment';
  return null;
}

/** Vrai si l'appel a pu écrire avant d'échouer : la source n'est alors pas garantie intacte. */
export function isUncertainError(error: RestoreError | null): boolean {
  return (
    error === 'restore_unreachable' ||
    error === 'restore_lost' ||
    error === 'restore_denied' ||
    error === 'restore_storage'
  );
}

export interface RestoreFailureBanner {
  title: string;
  cause: string;
  consequence: string;
  advice: string;
}

/** Une phrase : majuscule initiale et point final, quelle que soit la forme de la source. */
const sentence = (text: string): string => {
  const t = text.trim().replace(/\.$/, '');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
};

/** Contenu du bandeau d'échec : titre daté (UTC), cause, conséquence, conduite à tenir. */
export function restoreFailureBanner(input: {
  item: string;
  at: string | null;
  cause: string;
  consequence: string;
  /** Résultat inconnu : il faut vérifier avant de réessayer. */
  uncertain?: boolean;
}): RestoreFailureBanner {
  const when = dateTimeOf(input.at);
  const advice = input.uncertain
    ? `Une fois l’état vérifié, réessayez${RESTORE_FAILURE_ADVICE.slice('Réessayez'.length)}`
    : RESTORE_FAILURE_ADVICE;
  return {
    title: `Échec de la restauration de ${quoted(input.item)}${when && ` le ${when} UTC`}`,
    cause: sentence(input.cause),
    consequence: sentence(input.consequence),
    advice: when ? advice : advice.replace(' avec l’heure ci-dessus', ''),
  };
}

/** Bandeau d'erreur unique des trois parcours de restauration. */
export function RestoreFailureAlert({ banner }: { banner: RestoreFailureBanner }) {
  return (
    <Alert tone="error">
      <strong>{banner.title}</strong>
      <br />
      {[banner.cause, banner.consequence, banner.advice].join(' ')}
    </Alert>
  );
}
