import { useEffect, useState } from 'react';
import {
  REPORTS_HASH,
  REPORT_LABELS,
  fetchReports,
  lastSendLine,
  type LastSend,
} from '../reports.js';
import { Alert } from '../ui/index.js';

/** Rapport ou alerte qui n'est pas parti (l'essai a son résultat sur place, pas ici). */
export const isDeliveryFailure = (send: LastSend | null): send is LastSend =>
  send !== null && !send.ok && send.kind !== 'test';

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
  if (!isDeliveryFailure(send)) return null;
  return (
    <Alert tone="error" title={REPORT_LABELS.homeFailure}>
      <span className="alert-detail">
        Tentative du {lastSendLine(send)}. <a href={REPORTS_HASH}>{REPORT_LABELS.homeLink}</a>
      </span>
    </Alert>
  );
}
