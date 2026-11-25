import { DATA_TYPES, type DataType } from '@backup365/core';
import {
  DATA_TYPE_LABELS,
  MAIL_HELP,
  limitedTypes,
  setChargeScope,
  type FormErrors,
  type Mailbox,
  type PlanForm,
} from '../../plans.js';
import { ChoiceGroup, FormField } from '../../ui/index.js';
import { ErrorText } from '../ErrorText.js';

/** Aide du périmètre : ce que « Toute l'organisation » veut dire à chaque exécution (issue #545). */
export const SCOPE_HELP =
  'Pour chaque donnée, « Toute l’organisation » prend aussi, à chaque sauvegarde, les comptes et les sites créés après le plan.';

/** Second choix de chaque donnée : ce que l'on choisit un par un. */
const PICKED_LABELS: Record<DataType, string> = {
  mail: 'Boîtes choisies',
  onedrive: 'Comptes choisis',
  sharepoint: 'Sites choisis',
};

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
  const limited = limitedTypes(form);
  // Un groupe de choix qui disparaît emporte ses choix ; les ids inconnus du catalogue restent.
  const prune = (selectionTypes: readonly DataType[]): string[] => {
    const hidden = new Set<string>([
      ...(selectionTypes.some((d) => d !== 'sharepoint') ? [] : mailboxes).map((m) => m.id),
      ...(selectionTypes.includes('sharepoint') ? [] : sites).map((s) => s.id),
    ]);
    return form.selection.filter((id) => !hidden.has(id));
  };
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
                  const dataTypes = DATA_TYPES.filter((d) => toggle(form.dataTypes, t).includes(d));
                  // Une donnée ajoutée couvre toute l'organisation (par défaut) ; une donnée
                  // retirée emporte son périmètre.
                  const selectionTypes = limited.filter((d) => dataTypes.includes(d));
                  patch({
                    dataTypes,
                    selectionTypes,
                    scope: selectionTypes.length > 0 ? 'selection' : 'all',
                    selection: prune(selectionTypes),
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
      {form.dataTypes.length > 0 && (
        <fieldset className="choices" aria-describedby="scope-help">
          <legend>Périmètre</legend>
          <p id="scope-help" className="field-help scope-help">
            {SCOPE_HELP}
          </p>
          {DATA_TYPES.filter((t) => form.dataTypes.includes(t)).map((t) => (
            <ChoiceGroup
              key={t}
              legend={DATA_TYPE_LABELS[t]}
              name={`scope-${t}`}
              value={limited.includes(t) ? 'selection' : 'all'}
              options={[
                { value: 'all', label: 'Toute l’organisation' },
                { value: 'selection', label: PICKED_LABELS[t] },
              ]}
              onChange={(scope) => {
                const change = setChargeScope(form, t, scope);
                patch({ ...change, selection: prune(change.selectionTypes ?? []) });
              }}
            />
          ))}
        </fieldset>
      )}
      {limited.length > 0 && (
        <>
          {limited.some((t) => t !== 'sharepoint') && (
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
          {limited.includes('sharepoint') && (
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
