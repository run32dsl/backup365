/** Élément focalisable, réduit à ce que la logique de focus utilise (testable sans navigateur). */
export interface Focusable {
  focus: () => void;
}

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab et Maj+Tab restent dans la boîte : depuis le dernier élément Tab revient au premier,
 * depuis le premier Maj+Tab va au dernier ; un focus hors de la liste y est ramené.
 * Retourne `true` si la touche a été prise en charge.
 */
export function trapTab(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  focusables: Focusable[],
  active: unknown,
): boolean {
  if (e.key !== 'Tab') return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) {
    e.preventDefault();
    return true;
  }
  const index = focusables.indexOf(active as Focusable);
  if (index === -1) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** Échap ferme la boîte. */
export function closeOnEscape(
  e: { key: string; stopPropagation: () => void },
  close: () => void,
): boolean {
  if (e.key !== 'Escape') return false;
  e.stopPropagation();
  close();
  return true;
}

/**
 * Cible du focus à l'ouverture : le premier champ, sinon le bouton le moins destructeur
 * (`data-safe`), sinon le premier élément focalisable.
 */
export function initialFocus<T extends Focusable>(
  root: { querySelector: (selector: string) => T | null },
  focusables: T[],
): T | undefined {
  return (
    root.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
    root.querySelector('[data-safe]') ??
    focusables[0] ??
    undefined
  );
}

/** Élément du DOM rendu inerte, réduit au nécessaire. */
export interface InertTarget {
  inert: boolean;
}

/** Rend l'arrière-plan inerte ; retourne la fonction qui rétablit l'état d'origine. */
export function makeInert(background: InertTarget[]): () => void {
  const changed = background.filter((el) => !el.inert);
  for (const el of changed) el.inert = true;
  return () => {
    for (const el of changed) el.inert = false;
  };
}
