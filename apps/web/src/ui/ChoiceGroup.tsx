import { useId } from 'react';

export interface ChoiceOption<V extends string | number> {
  value: V;
  label: string;
  /** Option inactive ; `hint` en donne la raison, attachée à son libellé. */
  disabled?: boolean;
  hint?: string;
}

/**
 * Groupe de boutons radio natifs : `fieldset` et `legend`, flèches du clavier gérées par le
 * navigateur (même `name`), options espacées d'au moins `--space-4` (`.choice-row`).
 */
export function ChoiceGroup<V extends string | number>({
  legend,
  name,
  value,
  options,
  help,
  onChange,
}: {
  legend: string;
  name: string;
  value: V;
  options: ChoiceOption<V>[];
  help?: string;
  onChange: (value: V) => void;
}) {
  const uid = useId();
  const helpId = `${name}-help`;
  return (
    <fieldset className="choices" aria-describedby={help ? helpId : undefined}>
      <legend>{legend}</legend>
      <div className="choice-row">
        {options.map((o) => {
          const hintId = `${uid}-${String(o.value)}-hint`;
          return (
            <label key={o.value} className="choice">
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={o.value === value}
                disabled={o.disabled}
                aria-describedby={o.hint ? hintId : undefined}
                onChange={() => {
                  onChange(o.value);
                }}
              />
              <span>
                {o.label}
                {o.hint && (
                  <span id={hintId} className="field-help">
                    {' '}
                    ({o.hint})
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {help && (
        <p id={helpId} className="field-help">
          {help}
        </p>
      )}
    </fieldset>
  );
}
