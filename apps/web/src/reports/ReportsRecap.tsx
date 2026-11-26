import { useEffect, useRef } from 'react';
import { REPORT_LABELS, recapLines, type ReportSettings } from '../reports.js';
import { Alert, Button } from '../ui/index.js';

/** Exemple affiché au récapitulatif : données fictives, jamais celles du tenant. */
export const SAMPLE_REPORT = [
  'Plans : 4 à jour · 1 en retard · 0 en échec',
  'Volume sauvegardé : 12,4 Go · Durée : 38 min',
];

/** Étape 3 : récapitulatif en langage clair, puis « Enregistrer » ou « Modifier ». */
export function ReportsRecap({
  settings,
  plans,
  saving,
  error,
  onSave,
  onEdit,
}: {
  settings: ReportSettings;
  plans: number;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onEdit: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const lines =
    settings.recipients.length === 0
      ? ['Aucun destinataire : les rapports et les alertes seront désactivés.']
      : recapLines(settings);
  return (
    <section className="reports-recap" aria-labelledby="reports-recap-title">
      <h2 id="reports-recap-title" ref={title} tabIndex={-1}>
        Vérifier avant d’enregistrer
      </h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {settings.recipients.length > 0 && (
        <>
          <p>Exemple de rapport (données fictives) :</p>
          <pre className="report-sample">{SAMPLE_REPORT.join('\n')}</pre>
          {plans === 0 && <Alert tone="info">{REPORT_LABELS.noPlan}</Alert>}
        </>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="button-row reports-actions">
        <Button busy={saving} onClick={onSave}>
          Enregistrer
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          Modifier
        </Button>
      </div>
    </section>
  );
}
