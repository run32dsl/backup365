import { useEffect, useState } from 'react';
import { type Problem } from '../apiError.js';
import { runReasonError, type PlanItem } from '../plans.js';
import { REASON_EXAMPLES, ReasonField } from '../RestoreJourney.js';
import { Button, Dialog, ResultList } from '../ui/index.js';
import { PlanFailure } from './PlanFailure.js';

/** Réessayer ne changerait rien tant que la console n'est pas reliée à Microsoft 365. */
export function isRunBlocked(problem: Problem | undefined): problem is Problem {
  return problem?.code === 'backup_not_configured';
}

/** Résultat d'un lancement impossible : avertissement, rappel de la demande, « Fermer ». */
export function RunBlocked({
  problem,
  planName,
  reason,
  onClose,
}: {
  problem: Problem;
  planName: string;
  reason: string;
  onClose: () => void;
}) {
  return (
    <>
      <PlanFailure problem={problem} />
      <ResultList
        rows={[
          ['Plan', planName],
          ['Motif', reason],
        ]}
      />
      <p>Aucune sauvegarde n’a été lancée.</p>
      <div className="button-row dialog-actions">
        {/* Le formulaire vient d'être démonté : le focus passe au seul bouton restant. */}
        <Button data-safe autoFocus onClick={onClose}>
          Fermer
        </Button>
      </div>
    </>
  );
}

/** Échec éventuel d'un lancement qui peut être retenté, et boutons du formulaire. */
export function RunFeedback({
  problem,
  busy,
  onClose,
}: {
  problem?: Problem | undefined;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {problem && <PlanFailure problem={problem} />}
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" busy={busy}>
          Lancer la sauvegarde
        </Button>
      </div>
    </>
  );
}

export function RunDialog({
  plan,
  onClose,
  onRun,
}: {
  plan: PlanItem | null;
  onClose: () => void;
  onRun: (plan: PlanItem, reason: string) => Promise<Problem | undefined>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  // Chaque ouverture repart d'un formulaire vide.
  useEffect(() => {
    setReason('');
    setError(undefined);
    setProblem(undefined);
    setBusy(false);
  }, [plan]);
  const blocked = isRunBlocked(problem);
  const missing = runReasonError(reason);
  return (
    <Dialog
      open={plan !== null}
      title={blocked ? 'Lancement impossible' : `Lancer « ${plan?.name ?? ''} » maintenant`}
      onClose={onClose}
    >
      {blocked ? (
        <RunBlocked
          problem={problem}
          planName={plan?.name ?? ''}
          reason={reason.trim()}
          onClose={onClose}
        />
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!plan || busy) return;
            // Une nouvelle tentative efface l'échec précédent : un seul message à la fois.
            setProblem(undefined);
            if (missing !== undefined) {
              setError(missing);
              return;
            }
            setError(undefined);
            setBusy(true);
            void onRun(plan, reason).then((failure) => {
              setBusy(false);
              setProblem(failure);
            });
          }}
        >
          <ReasonField
            of="du lancement"
            placeholder={REASON_EXAMPLES.run}
            value={reason}
            error={error}
            onChange={setReason}
          />
          <RunFeedback problem={problem} busy={busy} onClose={onClose} />
        </form>
      )}
    </Dialog>
  );
}
