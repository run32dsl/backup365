import { useState, type ReactNode } from 'react';
import { Button, Dialog, ResultList } from './ui/index.js';

const ROWS = Array.from({ length: 24 }, (_, i): [string, ReactNode] => [
  `Ligne ${String(i + 1)}`,
  'Valeur d’exemple',
]);

/** Page « Composants » : boîte plus haute que l'écran, seul son corps défile (#590). */
export function LongDialogExample() {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Ouvrir une boîte au contenu long
      </Button>
      <Dialog open={open} title="Boîte au contenu long" onClose={close}>
        <p>
          Seul le corps défile : le titre, le « ✕ » et la barre d’actions restent visibles, la barre
          séparée du corps par un filet.
        </p>
        <ResultList rows={ROWS} />
        <div className="button-row dialog-actions">
          <Button variant="secondary" data-safe onClick={close}>
            Annuler
          </Button>
          <Button onClick={close}>Valider</Button>
        </div>
      </Dialog>
    </>
  );
}
