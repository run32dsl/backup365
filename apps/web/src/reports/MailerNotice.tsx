import type { ReactNode } from 'react';
import type { MailerStatus } from '../reports.js';
import { Alert, Button } from '../ui/index.js';

/** Pourquoi l'envoi est désactivé, selon ce qui manque côté serveur. */
const CAUSES: Record<'credentials' | 'sender' | 'permission' | 'refused' | 'unreachable', string> =
  {
    credentials: 'tant que la connexion Microsoft 365 n’est pas configurée sur le serveur.',
    sender: 'tant que la boîte d’envoi n’est pas renseignée sur le serveur.',
    permission: 'tant que l’envoi n’est pas autorisé.',
    refused:
      'tant que Microsoft 365 refuse les identifiants de l’application (secret expiré ou erroné).',
    unreachable: 'tant que Microsoft 365 ne confirme pas l’autorisation d’envoi.',
  };

/** Étapes de l'écran « Permission manquante » : tout se fait hors de la console. */
export const MAILER_STEPS: ReactNode[] = [
  <>
    Ajouter la permission d’application <code>Mail.Send</code> puis accorder le consentement
    administrateur.
  </>,
  <>Limiter la permission à la boîte d’envoi par une stratégie d’accès d’application.</>,
  <>
    Renseigner la boîte d’envoi (<code>BACKUP365_REPORT_SENDER</code>, guide d’installation), puis
    vérifier à nouveau.
  </>,
];

/** Bloc « Envoi » : prêt avec la boîte d'envoi, ou à autoriser avec les étapes à suivre. */
export function MailerNotice({
  mailer,
  checking,
  onRecheck,
}: {
  mailer: MailerStatus;
  checking: boolean;
  onRecheck: () => void;
}) {
  if (mailer.state === 'ready') {
    return (
      <Alert tone="success" title="Envoi par Microsoft 365 prêt">
        <span className="alert-detail">Boîte d’envoi : {mailer.sender}</span>
      </Alert>
    );
  }
  const cause = mailer.state === 'unconfigured' ? CAUSES[mailer.missing] : CAUSES[mailer.state];
  return (
    <Alert
      tone="warning"
      role="status"
      title="Envoi par mail à autoriser"
      action={
        <Button variant="secondary" busy={checking} onClick={onRecheck}>
          Vérifier à nouveau
        </Button>
      }
    >
      <span className="alert-detail">Les rapports sont désactivés {cause}</span>
      <ol className="alert-steps">
        {MAILER_STEPS.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </Alert>
  );
}
