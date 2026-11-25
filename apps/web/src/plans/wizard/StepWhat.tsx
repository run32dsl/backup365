import { DATA_TYPES, type DataType } from '@backup365/core';
import {
  DATA_TYPE_LABELS,
  MAIL_HELP,
  type FormErrors,
  type Mailbox,
  type PlanForm,
} from '../../plans.js';
import { ChoiceGroup, FormField } from '../../ui/index.js';
import { ErrorText } from '../ErrorText.js';

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Étape 1 : nom, données à sauvegarder, périmètre. */
export function StepWhat({
  form,
  errors,
  mailboxes,
  patch,
}: {
  form: PlanForm;
  errors: FormErrors;
  mailboxes: Mailbox[];
  patch: (change: Partial<PlanForm>) => void;
}) {
  const invalid = (key: keyof FormErrors) => (errors[key] ? true : undefined);
  return (
    <>
      <FormField
        label="Nom du plan"
        value={form.name}
        maxLength={100}
        autoComplete="off"
        error={errors.name}
        onChange={(e) => {
          patch({ name: e.currentTarget.value });
        }}
      />
      <fieldset
        className="choices"
        aria-describedby={errors.dataTypes ? 'data-types-error' : undefined}
      >
        <legend>Données à sauvegarder</legend>
        <div className="choice-row">
          {DATA_TYPES.map((t: DataType) => (
            <label key={t} className="choice">
              <input
                type="checkbox"
                aria-invalid={invalid('dataTypes')}
                aria-describedby={
                  [
                    t === 'mail' ? 'data-type-mail-help' : '',
                    errors.dataTypes ? 'data-types-error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                checked={form.dataTypes.includes(t)}
                onChange={() => {
                  patch({
                    dataTypes: DATA_TYPES.filter((d) => toggle(form.dataTypes, t).includes(d)),
                  });
                }}
              />
              {DATA_TYPE_LABELS[t]}
              {t === 'mail' && (
                <small id="data-type-mail-help" className="state-note">
                  {MAIL_HELP}
                </small>
              )}
            </label>
          ))}
        </div>
        <ErrorText id="data-types-error">{errors.dataTypes}</ErrorText>
      </fieldset>
      <ChoiceGroup
        legend="Périmètre"
        name="scope"
        value={form.scope}
        options={[
          { value: 'all', label: 'Toute l’organisation' },
          { value: 'selection', label: 'Boîtes et comptes choisis' },
        ]}
        onChange={(scope) => {
          patch({ scope });
        }}
      />
      {form.scope === 'selection' && (
        <fieldset
          className="choices"
          aria-describedby={errors.selection ? 'selection-error' : undefined}
        >
          <legend>Boîtes et comptes</legend>
          {mailboxes.length === 0 && <p>Aucune boîte à choisir pour l’instant.</p>}
          <div className="choice-list">
            {mailboxes.map((m) => (
              <label key={m.id} className="choice">
                <input
                  type="checkbox"
                  aria-invalid={invalid('selection')}
                  aria-describedby={errors.selection ? 'selection-error' : undefined}
                  checked={form.selection.includes(m.id)}
                  onChange={() => {
                    patch({ selection: toggle(form.selection, m.id) });
                  }}
                />
                {m.displayName}
              </label>
            ))}
          </div>
          <ErrorText id="selection-error">{errors.selection}</ErrorText>
        </fieldset>
      )}
    </>
  );
}
