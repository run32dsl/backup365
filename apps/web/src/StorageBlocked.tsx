import type { StatusReport } from '@backup365/core';
import { useEffect, useState, type Ref } from 'react';
import type { RunEvent } from './activities/runs.js';
import {
  ConfigurationNotice,
  ConnectionInterrupted,
  type ConfigurationState,
} from './ConfigurationBlock.js';
import type { PlanItem } from './plans.js';
import { fetchStatus } from './status.js';
import { CONDITIONAL_WRITES } from './status/StorageCheck.js';
import { Alert, Button } from './ui/index.js';

/**
 * Stockage bloqué : il ignore les écritures conditionnelles et, depuis le SDK 7.3.0, Atlas y refuse
 * toute sauvegarde et toute restauration (#612). Le serveur ne le dit qu'aux administrateurs.
 */
export const storageBlocked = (report: Pick<StatusReport, 'storage'> | null): boolean =>
  report?.storage?.conditionalWrites === 'ignored';

/** Titre commun du bandeau d'État des sources, de l'Accueil, de Plans et de Restaurer. */
export const STORAGE_BLOCKED_TITLE = CONDITIONAL_WRITES.ignoredTitle;

/** Conduite à tenir, la première phrase du bandeau. */
export const STORAGE_BLOCKED_ACTION = CONDITIONAL_WRITES.action;

/** Dit une seule fois, dans le bandeau de la page Plans, pourquoi « Lancer maintenant » manque. */
export const STORAGE_RUN_SUSPENDED_TEXT =
  'Le lancement manuel des plans est suspendu jusqu’à la correction du stockage.';

/** Complète le bandeau des parcours de restauration, comme celui de Plans (#614). */
export const STORAGE_RESTORE_SUSPENDED_TEXT =
  'La restauration est suspendue jusqu’à la correction du stockage.';

/** Le même blocage pour un opérateur, sans détail d'exploitation (#614). */
export const RESTORE_UNAVAILABLE_TEXT =
  'Restauration impossible pour l’instant. Prévenez un administrateur.';

/** Phrase de « Prochaine sauvegarde » quand le stockage est bloqué. */
export const STORAGE_NEXT_TEXT =
  'Aucune sauvegarde ne partira tant que le stockage n’est pas corrigé.';

/**
 * Bandeau d'erreur « Sauvegardes et restaurations bloquées sur ce stockage », le même que pour une
 * connexion Microsoft 365 interrompue : la conduite à tenir d'abord.
 */
export function StorageBlocked({
  runSuspended = false,
  restoreSuspended = false,
  focusRef,
}: {
  /** Page Plans : ajoute que le lancement manuel est suspendu (les lignes n'en disent rien). */
  runSuspended?: boolean;
  /** Parcours de restauration : ajoute que la restauration est suspendue (#614). */
  restoreSuspended?: boolean;
  /** Rend le bandeau focalisable : cible du bouton de la carte « Sauvegarde ». */
  focusRef?: Ref<HTMLDivElement>;
}) {
  return (
    <Alert tone="error" title={STORAGE_BLOCKED_TITLE} {...(focusRef ? { focusRef } : {})}>
      {STORAGE_BLOCKED_ACTION}
      {runSuspended && ` ${STORAGE_RUN_SUSPENDED_TEXT}`}
      {restoreSuspended && ` ${STORAGE_RESTORE_SUSPENDED_TEXT}`}
    </Alert>
  );
}

/**
 * Restauration suspendue (#614) : le bandeau du stockage pour un administrateur, une phrase sans
 * détail d'exploitation pour les autres rôles. Il remplace le formulaire, qui n'est pas affiché.
 */
export function RestoreBlocked({ admin }: { admin: boolean }) {
  return admin ? (
    <StorageBlocked restoreSuspended />
  ) : (
    <Alert tone="error">{RESTORE_UNAVAILABLE_TEXT}</Alert>
  );
}

/**
 * Boîte « Restaurer ce mail », stockage bloqué (#614) : le bandeau à la place du formulaire, et
 * « Fermer » pour seul bouton. Rien n'est saisi, rien n'est envoyé ni inscrit au journal d'audit.
 */
export function BlockedRestore({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  return (
    <>
      <RestoreBlocked admin={admin} />
      <div className="button-row dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </>
  );
}

/**
 * Bandeaux d'erreur en tête de la page Plans : stockage bloqué, puis connexion interrompue. La
 * suspension du lancement manuel n'est écrite qu'une fois, dans le premier (#606).
 */
export function RunHaltedAlerts({ blocked, since }: { blocked: boolean; since: string | null }) {
  return (
    <>
      {blocked && <StorageBlocked runSuspended />}
      {since !== null && <ConnectionInterrupted since={since} runSuspended={!blocked} />}
    </>
  );
}

/**
 * Bandeaux de l'administrateur sous le `h1` de l'Accueil, le plus grave d'abord : un stockage
 * bloqué arrête tout, connexion rétablie ou non. `focusRef` va au premier, cible de « Voir la
 * conduite à tenir ».
 */
export function HomeAlerts({
  blocked,
  config,
  plans,
  listed,
  focusRef,
}: {
  blocked: boolean;
  config: ConfigurationState;
  plans: readonly PlanItem[] | 'loading' | 'error';
  listed: readonly RunEvent[];
  focusRef?: Ref<HTMLDivElement>;
}) {
  const ref = focusRef ? { focusRef } : {};
  return (
    <>
      {blocked && <StorageBlocked {...ref} />}
      <ConfigurationNotice
        config={config}
        plans={plans}
        listed={listed}
        {...(blocked ? {} : ref)}
      />
    </>
  );
}

/**
 * Restauration refusée par le stockage : `storage` pour un administrateur, `restoreSuspended` pour
 * les autres rôles (#614).
 */
export const restoreBlocked = (
  report: Pick<StatusReport, 'storage' | 'restoreSuspended'> | null,
): boolean => storageBlocked(report) || report?.restoreSuspended === true;

/**
 * Lit `GET /api/status` et dit si la restauration est suspendue par le stockage, quel que soit le
 * rôle. Faux tant que la réponse n'est pas venue ou si elle échoue : la restauration garde alors
 * son propre message d'échec.
 */
export function useRestoreBlocked(enabled: boolean, fetcher = fetchStatus): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    fetcher().then(
      (report) => {
        if (current) setBlocked(restoreBlocked(report));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [enabled, fetcher]);
  return blocked;
}
