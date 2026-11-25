import { Alert } from './ui/index.js';
import { dateTimeOf, quoted } from './format.js';

/** Conduite à tenir après l'échec d'une restauration : la même pour la messagerie, OneDrive et SharePoint. */
export const RESTORE_FAILURE_ADVICE =
  'Réessayez ; si l’échec se répète, prévenez l’exploitant du serveur avec l’heure ci-dessus.';

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
