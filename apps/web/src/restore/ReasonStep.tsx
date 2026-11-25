import { useState, type FormEvent } from 'react';
import { isReasonValid } from '../mail.js';
import { REASON, REASON_EXAMPLES, RESTORE_BUTTONS as B, ReasonField } from '../RestoreJourney.js';
import { Button, WizardActions } from '../ui/index.js';

/** Étape « Motif », la même pour OneDrive et SharePoint (ADR 0016). */
export function ReasonStep({
  initial,
  onBack,
  onContinue,
}: {
  initial: string;
  onBack: () => void;
  onContinue: (reason: string) => void;
}) {
  const [reason, setReason] = useState(initial);
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isReasonValid(reason)) {
      setError(REASON.error);
      return;
    }
    onContinue(reason.trim());
  }

  return (
    <form onSubmit={submit} noValidate>
      <ReasonField
        placeholder={REASON_EXAMPLES.restore}
        value={reason}
        error={error}
        onChange={setReason}
      />
      <WizardActions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button type="submit">{B.next}</Button>
      </WizardActions>
    </form>
  );
}
