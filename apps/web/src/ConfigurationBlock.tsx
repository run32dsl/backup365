import { useEffect, useState, type ReactNode } from 'react';
import { fetchConfiguration, type Configuration } from './configuration.js';
import { workloadLabel } from './format.js';
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

/** Bandeau au-dessus des cartes : connexion à configurer, ou lecture impossible. Sinon rien. */
export function ConfigurationNotice({ config }: { config: ConfigurationState }) {
  if (config === 'loading') return null;
  if (config === 'error') {
    return (
      <Alert tone="error">
        Configuration indisponible. Réessayez ; si l’erreur persiste, consultez le journal du
        serveur.
      </Alert>
    );
  }
  if (config.microsoft.connected) return null;
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
