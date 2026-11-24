import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * Un bouton occupé garde le focus (pas de `disabled`) mais ignore le clic : sans cela une
 * double soumission resterait possible pendant la requête.
 */
export function guardClick<E extends { preventDefault: () => void }>(
  busy: boolean,
  handler?: (e: E) => void,
): (e: E) => void {
  return (e) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    handler?.(e);
  };
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Action en cours : `aria-busy`, clic ignoré, libellé inchangé (la largeur ne bouge pas). */
  busy?: boolean;
  /** Accès au bouton natif (focus programmatique). */
  ref?: Ref<HTMLButtonElement>;
}

/** Bouton natif : principal (plein), secondaire (contour) ou danger (texte rouge). */
export function Button({
  variant = 'primary',
  busy = false,
  type = 'button',
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      aria-busy={busy || undefined}
      aria-disabled={busy || rest['aria-disabled'] || undefined}
      onClick={guardClick<MouseEvent<HTMLButtonElement>>(busy, onClick)}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
