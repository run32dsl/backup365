import { useEffect, useState, type ReactNode } from 'react';
import type { RunEvent } from './activities/runs.js';
import { fetchConfiguration, type Configuration } from './configuration.js';
import { dateTimeOf, keepDateTogether, workloadLabel } from './format.js';
import type { PlanItem } from './plans.js';
import { useAdmin } from './role.js';
import { Alert } from './ui/index.js';

/** Étapes côté serveur : la console n'écrit aucun identifiant, tout se fait sur le serveur. */
export const SERVER_STEPS: ReactNode[] = [
  <>
    Renseigner l’identifiant de l’application Microsoft 365 dans le fichier <code>.env</code> du
    serveur.
  </>,
  <>
    Écrire son secret dans le fichier <code>secrets/m365_client_secret</code>, monté dans la
    console.
  </>,
  <>
    Redémarrer la console : <code>docker compose up -d</code>.
  </>,
];

/** Lien des messages « sauvegarde non configurée » vers le bandeau de la page d'accueil. */
export function ConfigurationLink() {
  if (useAdmin()) {
    return (
      <small className="alert-detail">
        <a href="#/">Voir les étapes de configuration sur la page d’accueil</a>
      </small>
    );
  }
  return (
    <small className="alert-detail">
      <a href="#/">Voir les étapes sur la page d’accueil</a> (réservé aux administrateurs).
    </small>
  );
}

/** Avancement de la lecture de la configuration. */
export type ConfigurationState = Configuration | 'loading' | 'error';

/** Lit la configuration une fois, pour un administrateur (`enabled`) ; sinon ne fait rien. */
export function useConfiguration(enabled: boolean): ConfigurationState {
  const [config, setConfig] = useState<ConfigurationState>('loading');
  useEffect(() => {
    if (!enabled) return;
    fetchConfiguration().then(setConfig, () => setConfig('error'));
  }, [enabled]);
  return config;
}

/** Ligne secondaire de la carte « Sauvegarde » ; `null` tant que la connexion n'est pas établie. */
export function connectionLine(config: ConfigurationState): string | null {
  if (config === 'loading' || config === 'error' || !config.microsoft.connected) return null;
  const workloads =
    config.workloads.length > 0 ? config.workloads.map(workloadLabel).join(', ') : 'aucune charge';
  return `Microsoft 365 connecté · ${workloads}`;
}

/** Fin (ou début, si elle dure encore) de l'exécution la plus récente des plans ; `null` sans exécution. */
export function lastKnownRun(plans: readonly PlanItem[]): string | null {
  let last: string | null = null;
  for (const p of plans) {
    const at = p.lastRun ? (p.lastRun.finishedAt ?? p.lastRun.startedAt) : null;
    if (at !== null && (last === null || Date.parse(at) > Date.parse(last))) last = at;
  }
  return last;
}

/**
 * Exécution listée la plus récente, au sens de la colonne « Heure » de « Derniers événements » :
 * le plus grand début. `undefined` si aucune ne l'est.
 */
export function latestListed(events: readonly RunEvent[]): RunEvent | undefined {
  return events.reduce<RunEvent | undefined>(
    (a, b) => (a === undefined || Date.parse(b.startedAt) > Date.parse(a.startedAt) ? b : a),
    undefined,
  );
}

/**
 * Lecture unique de la connexion Microsoft 365, la même sur l'Accueil et sur Plans (#604) :
 * non reliée sans aucune exécution dans l'historique, c'est une installation à terminer
 * (`unconfigured`) ; non reliée après au moins une exécution, la connexion est interrompue.
 */
export type ConnectionView =
  'loading' | 'error' | 'connected' | 'unconfigured' | { interruptedSince: string };

export function connectionView(
  config: ConfigurationState,
  plans: readonly PlanItem[] | 'loading' | 'error',
  /**
   * Accueil : exécutions de « Derniers événements ». La date d'interruption est alors le début de
   * la plus récente, celui de la colonne « Heure », jamais antérieur à une ligne du tableau (#608).
   */
  listed: readonly RunEvent[] = [],
): ConnectionView {
  if (config === 'loading' || config === 'error') return config;
  if (config.microsoft.connected) return 'connected';
  // Historique encore inconnu : rien plutôt qu'un bandeau peut-être faux.
  if (plans === 'loading') return 'loading';
  const since = latestListed(listed)?.startedAt ?? (plans === 'error' ? null : lastKnownRun(plans));
  return since === null ? 'unconfigured' : { interruptedSince: since };
}

/** Date de la dernière exécution d'une connexion interrompue ; `null` dans tout autre cas. */
export const interruptedSince = (view: ConnectionView): string | null =>
  typeof view === 'object' ? view.interruptedSince : null;

/** Titre du bandeau d'erreur ; la carte « Sauvegarde » de l'accueil ne le répète pas (#622). */
export const INTERRUPTED_TITLE = 'Connexion Microsoft 365 interrompue';

/** `Aucune sauvegarde ne part depuis le 26/11/2026 22:06 UTC.` */
export const interruptedSentence = (since: string): string =>
  keepDateTogether(`Aucune sauvegarde ne part depuis le ${dateTimeOf(since)} UTC.`);

/** Dit une seule fois, dans le bandeau de la page Plans, pourquoi « Lancer maintenant » manque. */
export const RUN_SUSPENDED_TEXT =
  'Le lancement manuel des plans est suspendu jusqu’au rétablissement de la connexion.';

/** Bandeau d'erreur : depuis quand plus rien ne part, puis la conduite à tenir sur le serveur. */
export function ConnectionInterrupted({
  since,
  runSuspended = false,
}: {
  since: string;
  /** Page Plans : ajoute que le lancement manuel est suspendu (les lignes n'en disent rien). */
  runSuspended?: boolean;
}) {
  return (
    <Alert tone="error" title={INTERRUPTED_TITLE}>
      <span className="alert-detail">
        {interruptedSentence(since)}
        {runSuspended && ` ${RUN_SUSPENDED_TEXT}`}
      </span>
      <ol className="alert-steps">
        <li>
          Vérifier l’identifiant de l’application Microsoft 365 dans le fichier <code>.env</code> du
          serveur.
        </li>
        <li>
          Vérifier son secret dans le fichier <code>secrets/m365_client_secret</code>.
        </li>
        <li>
          Redémarrer la console : <code>docker compose up -d</code>.
        </li>
      </ol>
    </Alert>
  );
}

/**
 * Bandeau au-dessus des cartes : connexion à configurer ou interrompue (selon l'historique des
 * `plans`), ou lecture impossible. Sinon rien.
 */
export function ConfigurationNotice({
  config,
  plans = [],
  listed = [],
}: {
  config: ConfigurationState;
  plans?: readonly PlanItem[] | 'loading' | 'error';
  /** Exécutions de « Derniers événements » : voir `connectionView`. */
  listed?: readonly RunEvent[];
}) {
  const view = connectionView(config, plans, listed);
  if (view === 'loading' || view === 'connected') return null;
  if (typeof view === 'object') return <ConnectionInterrupted since={view.interruptedSince} />;
  if (view === 'error') {
    return (
      <Alert tone="error">
        Configuration indisponible. Réessayez&#x202F;; si l’erreur persiste, consultez le journal du
        serveur.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" role="status" title="Connexion Microsoft 365 à configurer">
      <span className="alert-detail">
        Les identifiants se renseignent sur le serveur, pas dans la console.
      </span>
      <ol className="alert-steps">
        {SERVER_STEPS.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </Alert>
  );
}
