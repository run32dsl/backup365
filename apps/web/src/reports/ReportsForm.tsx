import { useId, useState, type FormEvent, type RefObject } from 'react';
import { REPORT_LABELS as L, parseRecipients, type ReportFrequency } from '../reports.js';
import { Alert, Button, ChoiceGroup, Dialog, EmptyState, StatusPill } from '../ui/index.js';

/** Brouillon du formulaire : le texte saisi tel quel, la fréquence et l'alerte. */
export interface ReportDraft {
  text: string;
  frequency: ReportFrequency;
  failureAlert: boolean;
}

/** Résultat de l'essai, affiché sur place sans déplacer le focus. */
export type TestResult = { ok: true; text: string } | { ok: false; text: string } | null;

/** Liste des destinataires saisis, chacun avec « Retirer » (confirmation). */
function RecipientList({
  list,
  disabled,
  onRemove,
}: {
  list: string[];
  disabled: boolean;
  onRemove: (address: string) => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <>
      <ul className="recipient-list" aria-label="Destinataires saisis">
        {list.map((address) => (
          <li key={address}>
            <span className="recipient-address">{address}</span>
            <Button
              variant="danger"
              disabled={disabled}
              aria-label={`Retirer ${address}`}
              onClick={() => {
                setRemoving(address);
              }}
            >
              Retirer
            </Button>
          </li>
        ))}
      </ul>
      <Dialog
        open={removing !== null}
        title="Retirer ce destinataire ?"
        onClose={() => {
          setRemoving(null);
        }}
      >
        <p>{removing} ne recevra plus les rapports.</p>
        <div className="button-row dialog-actions">
          <Button
            variant="danger"
            onClick={() => {
              if (removing) onRemove(removing);
              setRemoving(null);
            }}
          >
            Retirer
          </Button>
          <Button
            variant="secondary"
            data-safe
            onClick={() => {
              setRemoving(null);
            }}
          >
            Annuler
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Étapes 1 et 2 : régler, et éventuellement envoyer un essai. */
export function ReportsForm({
  draft,
  ready,
  error,
  testing,
  test,
  field,
  onChange,
  onTest,
  onContinue,
}: {
  draft: ReportDraft;
  /** Envoi prêt ; faux : champs grisés, pas de bouton d'essai. */
  ready: boolean;
  error: string | null;
  testing: boolean;
  test: TestResult;
  field: RefObject<HTMLTextAreaElement | null>;
  onChange: (draft: ReportDraft) => void;
  onTest: () => void;
  onContinue: () => void;
}) {
  const id = useId();
  const list = parseRecipients(draft.text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onContinue();
  };
  return (
    <form className="reports-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor={id}>{L.recipients}</label>
        <p id={`${id}-hint`} className="field-help">
          {L.recipientsHint}
        </p>
        <textarea
          ref={field}
          id={id}
          rows={3}
          value={draft.text}
          disabled={!ready}
          placeholder="marie.durand@exemple.invalid"
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-hint`, `${id}-help`, error ? `${id}-error` : '']
            .filter(Boolean)
            .join(' ')}
          onChange={(e) => {
            onChange({ ...draft, text: e.currentTarget.value });
          }}
        />
        <p id={`${id}-help`} className="field-help">
          {L.recipientsHelp}
        </p>
        {error && (
          <p id={`${id}-error`} className="field-error">
            <span aria-hidden="true">✖</span> {error}
          </p>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState
          action={
            <Button
              variant="secondary"
              disabled={!ready}
              onClick={() => {
                field.current?.focus();
              }}
            >
              Ajouter un destinataire
            </Button>
          }
        >
          {L.empty} <StatusPill status="pending" label="Rapport désactivé" />
        </EmptyState>
      ) : (
        <RecipientList
          list={list}
          disabled={!ready}
          onRemove={(address) => {
            onChange({ ...draft, text: list.filter((a) => a !== address).join(', ') });
          }}
        />
      )}
      <ChoiceGroup
        legend={L.frequency}
        name="report-frequency"
        value={draft.frequency}
        options={[
          { value: 'weekly', label: L.weekly, disabled: !ready },
          { value: 'daily', label: L.daily, disabled: !ready },
        ]}
        help={L.contentHelp}
        onChange={(frequency) => {
          onChange({ ...draft, frequency });
        }}
      />
      <fieldset className="choices">
        <legend>{L.alertLegend}</legend>
        <label className="choice">
          <input
            type="checkbox"
            checked={draft.failureAlert}
            disabled={!ready}
            onChange={(e) => {
              onChange({ ...draft, failureAlert: e.currentTarget.checked });
            }}
          />
          <span>{L.alert}</span>
        </label>
      </fieldset>
      <p className="field-help reports-audit">
        <span aria-hidden="true">ℹ</span> {L.audit}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="button-row reports-actions">
        {ready && (
          <Button variant="secondary" busy={testing} onClick={onTest}>
            Envoyer un essai
          </Button>
        )}
        <Button type="submit" disabled={!ready}>
          Continuer
        </Button>
      </div>
      <div role="status">
        {test?.ok && (
          <Alert tone="success" role="status">
            {test.text}
            <span className="alert-detail">
              Vérifiez aussi le dossier des courriers indésirables.
            </span>
          </Alert>
        )}
      </div>
      {test && !test.ok && <Alert tone="error">{test.text}</Alert>}
    </form>
  );
}
