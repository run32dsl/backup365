import type { ReactNode, Ref } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<AlertTone, { icon: string; role: 'alert' | 'status' }> = {
  info: { icon: 'ℹ', role: 'status' },
  success: { icon: '✔', role: 'status' },
  warning: { icon: '⚠', role: 'alert' },
  error: { icon: '✖', role: 'alert' },
};

/** Rôle ARIA d'une alerte : `alert` pour l'erreur et l'avertissement, `status` sinon. */
export const alertRole = (tone: AlertTone): 'alert' | 'status' => TONES[tone].role;

/** Message d'alerte : icône et texte, jamais la couleur seule ; sans détail technique. */
export function Alert({
  tone,
  title,
  children,
  action,
  id,
  role,
  focusRef,
}: {
  tone: AlertTone;
  /** Cause courte, en gras sur sa propre ligne ; le corps donne la conséquence et la conduite. */
  title?: string;
  children: ReactNode;
  /** Action proposée, par exemple « Réessayer ». */
  action?: ReactNode;
  /** Identifiant, pour qu'un contrôle le cite par `aria-describedby`. */
  id?: string;
  /** Rôle imposé : `status` pour un avertissement qui n'interrompt pas la lecture. */
  role?: 'alert' | 'status';
  /** Rend l'alerte focalisable par programme (confirmation qui reçoit le focus). */
  focusRef?: Ref<HTMLDivElement>;
}) {
  const { icon, role: toneRole } = TONES[tone];
  return (
    <div
      id={id}
      className={`alert alert-${tone}`}
      role={role ?? toneRole}
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="alert-text">
        {title ? <strong className="alert-title">{title}</strong> : null}
        {children}
      </span>
      {action}
    </div>
  );
}
