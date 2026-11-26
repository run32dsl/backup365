import { DATA_TYPES, type DataType } from '@backup365/core';
import {
  CONTACTS_HELP,
  DATA_TYPE_LABELS,
  MAIL_HELP,
  type FormErrors,
  type Mailbox,
  type PlanForm,
} from '../../plans.js';
import { ChoiceGroup, FormField } from '../../ui/index.js';
import { ErrorText } from '../ErrorText.js';

/** Aide sous une case de charge, quand elle en a une. */
const HELP: Partial<Record<DataType, string>> = { mail: MAIL_HELP, contacts: CONTACTS_HELP };

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Groupe de cases d'un service dans le périmètre choisi (mêmes `.choice` que les données). */
function SelectionGroup({
  legend,
  empty,
  items,
  selection,
  invalid,
  onToggle,
}: {
  legend: string;
  empty: string;
  items: readonly Mailbox[];
  selection: readonly string[];
  invalid: true | undefined;
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="choices" aria-describedby={invalid ? 'selection-error' : undefined}>
      <legend>{legend}</legend>
      {items.length === 0 && <p>{empty}</p>}
      <div className="choice-list">
        {items.map((m) => (
          <label key={m.id} className="choice">
            <input
              type="checkbox"
              aria-invalid={invalid}
              aria-describedby={invalid ? 'selection-error' : undefined}
              checked={selection.includes(m.id)}
              onChange={() => {
                onToggle(m.id);
              }}
            />
            {m.displayName}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Étape 1 : nom, données à sauvegarder, périmètre. */
export function StepWhat({
  form,
  errors,
  mailboxes,
  sites,
  patch,
}: {
  form: PlanForm;
  errors: FormErrors;
  mailboxes: Mailbox[];
  /** Sites SharePoint sauvegardables, proposés quand SharePoint est coché. */
  sites: Mailbox[];
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
        {/* Une charge par ligne : les aides de Messagerie et Contacts déséquilibraient la rangée. */}
        <div className="choice-list">
          {DATA_TYPES.map((t: DataType) => (
            <label key={t} className="choice">
              <input
                type="checkbox"
                aria-invalid={invalid('dataTypes')}
                aria-describedby={
                  [HELP[t] ? `data-type-${t}-help` : '', errors.dataTypes ? 'data-types-error' : '']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                checked={form.dataTypes.includes(t)}
                onChange={() => {
                  const dataTypes = DATA_TYPES.filter((d) => toggle(form.dataTypes, t).includes(d));
                  // Un groupe qui disparaît emporte ses choix ; les ids inconnus du catalogue restent.
                  const hidden = new Set<string>([
                    ...(dataTypes.some((d) => d !== 'sharepoint') ? [] : mailboxes).map(
                      (m) => m.id,
                    ),
                    ...(dataTypes.includes('sharepoint') ? [] : sites).map((s) => s.id),
                  ]);
                  patch({
                    dataTypes,
                    selection: form.selection.filter((id) => !hidden.has(id)),
                  });
                }}
              />
              {DATA_TYPE_LABELS[t]}
              {HELP[t] && (
                <small id={`data-type-${t}-help`} className="state-note">
                  {HELP[t]}
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
          { value: 'selection', label: 'Boîtes, comptes et sites choisis' },
        ]}
        onChange={(scope) => {
          patch({ scope });
        }}
      />
      {form.scope === 'selection' && (
        <>
          {form.dataTypes.some((t) => t !== 'sharepoint') && (
            <SelectionGroup
              legend="Boîtes et comptes"
              empty="Aucune boîte à choisir pour l’instant."
              items={mailboxes}
              selection={form.selection}
              invalid={invalid('selection')}
              onToggle={(id) => {
                patch({ selection: toggle(form.selection, id) });
              }}
            />
          )}
          {form.dataTypes.includes('sharepoint') && (
            <SelectionGroup
              legend="Sites SharePoint"
              empty="Aucun site à choisir pour l’instant."
              items={sites}
              selection={form.selection}
              invalid={invalid('selection')}
              onToggle={(id) => {
                patch({ selection: toggle(form.selection, id) });
              }}
            />
          )}
          <ErrorText id="selection-error">{errors.selection}</ErrorText>
        </>
      )}
    </>
  );
}
