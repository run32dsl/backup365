import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.js';
import {
  FOCUSABLE_SELECTOR,
  closeOnEscape,
  initialFocus,
  makeInert,
  trapTab,
} from './dialog-focus.js';

/** Contenu de la boîte, sans portail ni effet : `role="dialog"`, `aria-modal`, titre relié. */
export function DialogPanel({
  titleId,
  title,
  onClose,
  dismissible = true,
  onKeyDown,
  panelRef,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  /** Faux : pas de « ✕ » ; la boîte ne se ferme que par une action de son contenu. */
  dismissible?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="dialog-backdrop">
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <Button variant="secondary" aria-label="Fermer" onClick={onClose}>
              <span aria-hidden="true">✕</span>
            </Button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Boîte de dialogue modale. À l'ouverture le focus va sur le premier champ (sinon sur le bouton
 * marqué `data-safe`), Tab reste dans la boîte, Échap la ferme, l'arrière-plan est `inert` et le
 * focus revient au déclencheur à la fermeture. Marquer le bouton le moins destructeur `data-safe`.
 */
export function Dialog({
  open,
  title,
  onClose,
  dismissible = true,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Faux : ni « ✕ » ni Échap ; seul le contenu de la boîte peut la fermer. */
  dismissible?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  if (typeof document !== 'undefined' && host.current === null) {
    host.current = document.createElement('div');
  }

  useEffect(() => {
    const container = host.current;
    if (!open || !container) return;
    const trigger = document.activeElement;
    document.body.appendChild(container);
    const restoreBackground = makeInert(
      Array.from(document.body.children).filter((el): el is HTMLElement => {
        return el instanceof HTMLElement && el !== container;
      }),
    );
    const node = panel.current;
    if (node) {
      initialFocus(
        node,
        Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
      )?.focus();
    }
    // Sur le document : si le focus est tombé sur `body` (clic sur du texte), Échap et Tab
    // doivent encore agir sur la boîte.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (closeOnEscape(e, () => onCloseRef.current(), dismissibleRef.current)) return;
      if (panel.current) {
        trapTab(
          e,
          Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
          document.activeElement,
        );
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreBackground();
      container.remove();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [open]);

  if (!open || !host.current) return null;
  return createPortal(
    <DialogPanel
      titleId={titleId}
      title={title}
      onClose={onClose}
      dismissible={dismissible}
      panelRef={panel}
    >
      {children}
    </DialogPanel>,
    host.current,
  );
}
