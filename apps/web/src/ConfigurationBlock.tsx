import { useEffect, useState } from 'react';
import { fetchConfiguration, type Configuration } from './configuration.js';
import { workloadLabel } from './format.js';
import { Alert, StatusPill } from './ui/index.js';

/** Étapes côté serveur : la console n'écrit aucun identifiant, tout se fait sur le serveur. */
export const SERVER_STEPS = [
  'Renseigner l’identifiant de l’application Microsoft 365 dans le fichier .env du serveur.',
  'Écrire son secret dans le fichier secrets/m365_client_secret, monté dans la console.',
  'Redémarrer la console : docker compose up -d.',
];

/** Lien des messages « sauvegarde non configurée » vers le bloc de la page d'accueil. */
export function ConfigurationLink() {
  return (
    <small className="alert-detail">
      <a href="#/">Voir le bloc « Configuration » de la page d’accueil</a> (réservé aux
      administrateurs).
    </small>
  );
}

/** Contenu du bloc, une fois l'état connu. */
export function ConfigurationView({ config }: { config: Configuration }) {
  return (
    <>
      <p>
        Connexion Microsoft 365 :{' '}
        {config.microsoft.connected ? (
          <StatusPill status="compliant" label="Connectée" />
        ) : (
          <StatusPill status="late" label="Non configurée" />
        )}
      </p>
      <p>
        Charges configurées :{' '}
        {config.workloads.length > 0 ? config.workloads.map(workloadLabel).join(', ') : 'aucune'}.
      </p>
      {!config.microsoft.connected && (
        <>
          <p>Étapes à suivre sur le serveur :</p>
          <ol>
            {SERVER_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
      <p>
        Lecture seule : les identifiants se renseignent sur le serveur, jamais depuis la console.
      </p>
    </>
  );
}

/** Contenu du bloc selon l'avancement de la lecture. */
export function ConfigurationState({ config }: { config: Configuration | 'loading' | 'error' }) {
  if (config === 'loading') return <p>Chargement…</p>;
  if (config === 'error') {
    return (
      <Alert tone="error">
        Configuration indisponible. Réessayez ; si l’erreur persiste, consultez le journal du
        serveur.
      </Alert>
    );
  }
  return <ConfigurationView config={config} />;
}

/** Bloc « Configuration » de la page d'accueil, pour les administrateurs. */
export function ConfigurationBlock() {
  const [config, setConfig] = useState<Configuration | 'loading' | 'error'>('loading');
  useEffect(() => {
    fetchConfiguration().then(setConfig, () => setConfig('error'));
  }, []);
  return (
    <section aria-labelledby="configuration-title">
      <h2 id="configuration-title">Configuration</h2>
      <ConfigurationState config={config} />
    </section>
  );
}
