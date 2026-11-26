import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import {
  REPORT_LABELS as L,
  addRecipient,
  pendingEntryError,
  type ReportFrequency,
} from '../reports.js';
import {
  Alert,
  Button,
  ChoiceGroup,
  Dialog,
  EmptyState,
  FormField,
  StatusPill,
} from '../ui/index.js';

/** Brouillon du formulaire : la liste des destinataires, la fréquence et l'alerte. */
export interface ReportDraft {
  recipients: string[];
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
  const intro = useId();
  return (
    <>
      <p id={intro} className="recipient-intro">
        {L.recipientsHelp}
      </p>
      <ul className="recipient-list" aria-label={L.recipients} aria-describedby={intro}>
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
  field: RefObject<HTMLInputElement | null>;
  onChange: (draft: ReportDraft) => void;
  onTest: () => void;
  onContinue: () => void;
}) {
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const list = draft.recipients;
  // Une adresse tapée mais pas ajoutée bloque l'étape suivante, au lieu d'être perdue.
  const unlessPending = (next: () => void) => () => {
    const pending = pendingEntryError(entry);
    setEntryError(pending);
    if (pending) field.current?.focus();
    else next();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    unlessPending(onContinue)();
  };
  const add = () => {
    const out = addRecipient(list, entry);
    if (!out.ok) {
      setEntryError(out.error);
      field.current?.focus();
      return;
    }
    setEntry('');
    setEntryError(null);
    onChange({ ...draft, recipients: out.list });
  };
  // Entrée dans le champ ajoute l'adresse, au lieu de soumettre le formulaire (« Continuer »).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    add();
  };
  return (
    <form className="reports-form" noValidate onSubmit={submit}>
      <div className="reports-add">
        <FormField
          ref={field}
          label={L.addRecipient}
          type="email"
          autoComplete="off"
          value={entry}
          disabled={!ready}
          placeholder="nom@domaine"
          error={entryError ?? error ?? undefined}
          onChange={(e) => {
            setEntry(e.currentTarget.value);
            setEntryError(null);
          }}
          onKeyDown={onKeyDown}
          adornment={() => (
            <Button variant="secondary" disabled={!ready} onClick={add}>
              Ajouter
            </Button>
          )}
        />
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
            onChange({ ...draft, recipients: list.filter((a) => a !== address) });
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
      <Alert tone="info">{L.audit}</Alert>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="button-row reports-actions">
        {ready && (
          <Button variant="secondary" busy={testing} onClick={unlessPending(onTest)}>
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
