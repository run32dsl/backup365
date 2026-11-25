import { useEffect, useState } from 'react';
import { type Problem } from '../apiError.js';
import { runReasonError, type Mailbox, type PlanItem } from '../plans.js';
import { REASON_EXAMPLES, ReasonField } from '../RestoreJourney.js';
import { Alert, Button, Dialog } from '../ui/index.js';
import { PlanFailure } from './PlanFailure.js';
import { PlanRecap } from './PlanRecap.js';

/** Contenu de la boîte de suppression : le plan, ce qui disparaît, le motif. Sans accès réseau. */
export function DeleteForm({
  plan,
  mailboxes = [],
  error,
  failure,
  busy = false,
  onSubmit,
  onCancel,
}: {
  plan: PlanItem;
  mailboxes?: readonly Mailbox[];
  error?: string | undefined;
  failure?: Problem | undefined;
  busy?: boolean;
  onSubmit?: (reason: string) => void;
  onCancel?: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(reason.trim());
      }}
    >
      <PlanRecap plan={plan} mailboxes={mailboxes} />
      <Alert tone="warning" title="Suppression définitive">
        Aucune nouvelle sauvegarde ne sera faite. L’historique des exécutions de ce plan sera
        effacé. Les sauvegardes déjà faites restent dans le stockage : la console ne les supprime
        pas.
      </Alert>
      <ReasonField
        of="de la suppression"
        placeholder={REASON_EXAMPLES.deletePlan}
        value={reason}
        error={error}
        onChange={setReason}
      />
      {failure && <PlanFailure problem={failure} />}
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onCancel}>
          Annuler
        </Button>
        <Button variant="danger" type="submit" busy={busy}>
          Supprimer le plan
        </Button>
      </div>
    </form>
  );
}

export function DeleteDialog({
  plan,
  mailboxes,
  onClose,
  onDelete,
}: {
  plan: PlanItem | null;
  mailboxes: readonly Mailbox[];
  onClose: () => void;
  onDelete: (plan: PlanItem, reason: string) => Promise<Problem | undefined>;
}) {
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError(undefined);
    setFailure(undefined);
    setBusy(false);
  }, [plan]);
  return (
    <Dialog open={plan !== null} title={'Supprimer ce plan\u202F?'} onClose={onClose}>
      {plan && (
        <DeleteForm
          key={plan.id}
          plan={plan}
          mailboxes={mailboxes}
          error={error}
          failure={failure}
          busy={busy}
          onCancel={onClose}
          onSubmit={(reason) => {
            if (busy) return;
            setFailure(undefined);
            const missing = runReasonError(reason);
            setError(missing);
            if (missing !== undefined) return;
            setBusy(true);
            void onDelete(plan, reason).then((problem) => {
              setBusy(false);
              setFailure(problem);
            });
          }}
        />
      )}
    </Dialog>
  );
}
