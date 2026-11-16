import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/** Part du maximum à partir de laquelle le compteur est annoncé aux lecteurs d'écran. */
const ANNOUNCE_RATIO = 0.9;

/** Texte lu par la région `aria-live` : vide tant que la limite est loin, pour ne pas lire chaque frappe. */
export function counterAnnouncement(length: number, max: number): string {
  return length >= Math.ceil(max * ANNOUNCE_RATIO) ? `${length} sur ${max} caractères` : '';
}

/** Valeur d'`aria-describedby` : l'aide puis l'erreur, quand elles existent. */
export function describedBy(
  parts: { help?: string; error?: string },
  id: string,
): string | undefined {
  const ids = [parts.help ? `${id}-help` : '', parts.error ? `${id}-error` : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  help?: string;
  error?: string;
  /** Affiche « n / max » ; exige `value` (champ contrôlé) et fixe `maxLength`. */
  counterMax?: number;
  /** Élément placé après le champ (ex. bouton « Afficher ») ; reçoit l'identifiant du champ. */
  adornment?: (inputId: string) => ReactNode;
}

/**
 * Champ de formulaire : libellé visible relié par `for`, aide et erreur reliées par
 * `aria-describedby`, `aria-invalid` en erreur, compteur de caractères.
 */
export function FormField({
  label,
  help,
  error,
  counterMax,
  adornment,
  value,
  ...input
}: FormFieldProps) {
  const id = useId();
  const length = typeof value === 'string' ? value.length : 0;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-control">
        <input
          {...input}
          id={id}
          value={value}
          maxLength={counterMax ?? input.maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ help, error }, id)}
        />
        {adornment?.(id)}
      </div>
      {(help !== undefined || counterMax !== undefined) && (
        <div className="field-meta">
          {help && (
            <p id={`${id}-help`} className="field-help">
              {help}
            </p>
          )}
          {counterMax !== undefined && (
            <>
              <span className="field-counter" aria-hidden="true">
                {length} / {counterMax}
              </span>
              <span className="sr-only" aria-live="polite">
                {counterAnnouncement(length, counterMax)}
              </span>
            </>
          )}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          <span aria-hidden="true">✖</span> {error}
        </p>
      )}
    </div>
  );
}
