import { useEffect, useState } from 'react';
import {
  DELIVERY_FAILURE_BODY,
  REPORTS_HASH,
  REPORT_LABELS,
  deliveryFailureTitle,
  fetchReports,
  type LastSend,
} from '../reports.js';
import { Alert } from '../ui/index.js';

/** Rapport ou alerte qui n'est pas parti (l'essai a son résultat sur place, pas ici). */
export const isDeliveryFailure = (send: LastSend | null): send is LastSend =>
  send !== null && !send.ok && send.kind !== 'test';

/**
 * Avertissement d'un envoi non parti : problème secondaire (aucune sauvegarde touchée), donc
 * `warning` en `role="status"`, jamais la couleur des pannes bloquantes.
 */
export function ReportFailureAlert({ send }: { send: LastSend }) {
  return (
    <Alert
      tone="warning"
      role="status"
      title={deliveryFailureTitle(send)}
      action={
        <a className="alert-link" href={REPORTS_HASH}>
          {REPORT_LABELS.homeLink}
        </a>
      }
    >
      {DELIVERY_FAILURE_BODY.join(' ')}
    </Alert>
  );
}

/**
 * Accueil, administrateur : le dernier rapport ou la dernière alerte n'a pas pu être envoyé.
 * Rien n'échoue en silence ; sans réponse du serveur, rien n'est affiché.
 */
export function ReportFailureNotice({ enabled }: { enabled: boolean }) {
  const [send, setSend] = useState<LastSend | null>(null);
  useEffect(() => {
    if (!enabled) return;
    fetchReports().then(
      (view) => {
        setSend(view.lastSend);
      },
      () => undefined,
    );
  }, [enabled]);
  return isDeliveryFailure(send) ? <ReportFailureAlert send={send} /> : null;
}
