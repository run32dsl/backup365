import type { FailureCause } from '@backup365/core';
import { NBSP, NNBSP } from './format.js';

const SEP = `${NNBSP};`;
const REPEAT = `${SEP} si l’échec se répète, prévenez l’exploitant du serveur.`;
const WAIT = `Attendez la prochaine exécution${NBSP}: elle reprendra la sauvegarde.`;
/** Un administrateur peut aussi relancer : le bandeau de Plans lui offre « Lancer maintenant ». */
const WAIT_OR_RUN =
  'Attendez la prochaine exécution, qui reprendra la sauvegarde, ou relancez le plan.';

/**
 * Cause et conduite à tenir de chaque échec d'une sauvegarde : seule source de ces textes, lue
 * par le bandeau de Plans de protection et par Activités › Sauvegardes (#602). Chaque texte est
 * une phrase (majuscule, point final) ; la conduite à tenir est à l'impératif, pour un
 * administrateur ou pour un opérateur.
 */
export const FAILURE_TEXT: Record<
  FailureCause,
  { cause: string; admin: string; operator: string }
> = {
  interrupted: {
    cause: 'La console a été arrêtée pendant l’exécution.',
    admin: WAIT_OR_RUN,
    operator: WAIT,
  },
  backup_errors: {
    cause: 'Des dossiers ou des fichiers n’ont pas pu être sauvegardés.',
    admin: `Vérifiez l’autorisation de l’application Microsoft 365 et l’accès au stockage, puis relancez le plan${REPEAT}`,
    operator: `Demandez à un administrateur de vérifier l’autorisation de l’application Microsoft 365 et l’accès au stockage, puis de relancer le plan${REPEAT}`,
  },
  no_result: {
    cause: 'Aucune donnée n’a été sauvegardée pour cette source.',
    admin: 'Vérifiez que la source existe toujours dans Microsoft 365, puis relancez le plan.',
    operator:
      'Demandez à un administrateur de vérifier que la source existe toujours dans Microsoft 365, puis de relancer le plan.',
  },
  owner_busy: {
    cause: 'Une autre opération (sauvegarde ou restauration) était déjà en cours sur cette source.',
    admin:
      'Attendez la prochaine exécution, qui reprendra la sauvegarde, ou relancez le plan dans quelques minutes.',
    operator: WAIT,
  },
  access_refused: {
    cause: 'Microsoft 365 a refusé l’accès à cette source.',
    admin:
      'Vérifiez les autorisations accordées à l’application Microsoft 365, puis relancez le plan.',
    operator:
      'Demandez à un administrateur de vérifier les autorisations accordées à l’application Microsoft 365, puis de relancer le plan.',
  },
  graph_unavailable: {
    cause: 'Microsoft 365 n’a pas répondu, malgré plusieurs essais.',
    admin: WAIT_OR_RUN,
    operator: WAIT,
  },
  storage_unavailable: {
    cause: 'Le stockage des sauvegardes n’a pas répondu, malgré plusieurs essais.',
    admin: 'Vérifiez que le stockage est joignable, puis relancez le plan.',
    operator:
      'Demandez à un administrateur de vérifier que le stockage est joignable, puis de relancer le plan.',
  },
  format_unsupported: {
    cause:
      'Les sauvegardes existantes sont dans un format que cette version ne prend pas en charge.',
    admin: 'Mettez la console à jour, puis relancez le plan.',
    operator: 'Demandez à un administrateur de mettre la console à jour, puis de relancer le plan.',
  },
  write_refused: {
    cause: `Le moteur de sauvegarde a refusé d’écrire des données qu’il n’aurait pas pu relire${SEP} rien n’a été écrit.`,
    admin: `Relancez le plan${REPEAT}`,
    operator: `Demandez à un administrateur de relancer le plan${REPEAT}`,
  },
  unknown: {
    cause: 'La sauvegarde a échoué pour une raison non identifiée.',
    admin: `Relancez le plan${REPEAT}`,
    operator: `Demandez à un administrateur de relancer le plan${REPEAT}`,
  },
};

/** Une cause en milieu de phrase : minuscule initiale, sauf un nom propre (« Microsoft 365 »). */
export const lowerFirst = (s: string): string =>
  s.startsWith('Microsoft') ? s : s.charAt(0).toLowerCase() + s.slice(1);

/** Ce que contient une boîte mail (mails, contacts, agenda) ; le reste (OneDrive, SharePoint) est fait de fichiers. */
const MAILBOX_TYPES: readonly string[] = ['mail', 'contacts', 'calendar'];

/**
 * Cause d'un échec, dite selon ce que le plan sauvegarde (#632). Pour `backup_errors` : des
 * « mails » si le plan ne sauvegarde que des boîtes mail, des « éléments » s'il mêle boîtes mail
 * et fichiers, la phrase de `FAILURE_TEXT` (fichiers) sinon ou si le contenu n'est pas connu.
 */
export function causeText(cause: FailureCause | undefined, dataTypes?: readonly string[]): string {
  const t = FAILURE_TEXT[cause ?? 'unknown'] ?? FAILURE_TEXT.unknown;
  if (cause !== 'backup_errors' || !dataTypes?.length) return t.cause;
  const mail = dataTypes.some((d) => MAILBOX_TYPES.includes(d));
  const files = dataTypes.some((d) => !MAILBOX_TYPES.includes(d));
  if (mail && files) return 'Des éléments n’ont pas pu être sauvegardés.';
  return mail ? 'Des dossiers ou des mails n’ont pas pu être sauvegardés.' : t.cause;
}

/**
 * Cause et conduite à tenir d'un échec, selon le rôle ; `unknown` sert de repli. `dataTypes` :
 * ce que le plan sauvegarde, pour nommer ce qui manque (voir `causeText`).
 */
export function failureText(
  cause: FailureCause | undefined,
  admin: boolean,
  dataTypes?: readonly string[],
): { cause: string; advice: string } {
  const t = FAILURE_TEXT[cause ?? 'unknown'] ?? FAILURE_TEXT.unknown;
  return { cause: causeText(cause, dataTypes), advice: admin ? t.admin : t.operator };
}
