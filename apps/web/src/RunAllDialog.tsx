import { useEffect, useState } from 'react';
import { plural, quoted } from './format.js';
import { runPlan, runReasonError, type PlanItem } from './plans.js';
import { REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import { Alert, Button, Dialog, ResultList } from './ui/index.js';

/** `1 sauvegarde lancée`, `3 sauvegardes lancées`. */
export const launchedLabel = (n: number): string =>
  plural(n, 'sauvegarde lancée', 'sauvegardes lancées');

/** Résultat du lancement de tous les plans : démarrés ou mis en file, et échecs (message du serveur). */
export interface RunAllResult {
  launched: number;
  failures: string[];
}

/** Raison du serveur après les deux-points : minuscule initiale, sauf sigle (« URL »). */
const afterColon = (message: string): string =>
  /^\p{Lu}\p{Lu}/u.test(message) ? message : message.charAt(0).toLowerCase() + message.slice(1);

/** Lance chaque plan l'un après l'autre avec le même motif (`POST /api/plans/:id/run`). */
export async function runAll(
  plans: readonly PlanItem[],
  reason: string,
  run: typeof runPlan = runPlan,
): Promise<RunAllResult> {
  const result: RunAllResult = { launched: 0, failures: [] };
  for (const plan of plans) {
    const outcome = await run(plan.id, reason);
    if (outcome.ok) result.launched += 1;
    else result.failures.push(`${quoted(plan.name)} : ${afterColon(outcome.message)}`);
  }
  return result;
}

/** Titre de la boîte une fois le lancement fait avec au moins un échec. */
export const runAllTitle = (result: RunAllResult): string =>
  result.launched > 0 ? 'Lancement partiel' : 'Lancement impossible';

/** Bilan en tête du bandeau : « 3 sauvegardes lancées, 1 non lancée ». */
export const runAllSummary = (result: RunAllResult): string =>
  result.launched > 0
    ? `${launchedLabel(result.launched)}, ${plural(result.failures.length, 'non lancée', 'non lancées')}`
    : 'Aucune sauvegarde n’a été lancée.';

/** Résultat d'un lancement avec échecs : bilan, plans non lancés, motif rappelé, « Fermer ». */
export function RunAllOutcome({
  result,
  reason,
  onClose,
}: {
  result: RunAllResult;
  reason: string;
  onClose: () => void;
}) {
  return (
    <>
      <Alert tone={result.launched > 0 ? 'warning' : 'error'} title={runAllSummary(result)}>
        <ul className="alert-steps">
          {result.failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Alert>
      <ResultList rows={[['Motif', reason.trim()]]} />
      <div className="button-row dialog-actions">
        {/* Le formulaire vient d'être démonté : le focus passe au seul bouton restant. */}
        <Button data-safe autoFocus onClick={onClose}>
          Fermer
        </Button>
      </div>
    </>
  );
}

/** « Sauvegarder maintenant » : motif, lancement de tous les plans, puis résultat s'il y a un échec. */
export function RunAllDialog({
  plans,
  open,
  onClose,
  onDone,
  onReload,
}: {
  plans: readonly PlanItem[];
  open: boolean;
  onClose: () => void;
  onDone: (result: RunAllResult) => void;
  /** Lancement partiel : la boîte affiche le résultat, la liste se recharge. */
  onReload: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<RunAllResult>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
      setOutcome(undefined);
      setBusy(false);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      title={outcome ? runAllTitle(outcome) : 'Sauvegarder maintenant'}
      onClose={() => {
        // Fermer ne coupe pas les lancements en cours : on attend leur fin.
        if (!busy) onClose();
      }}
    >
      {outcome ? (
        <RunAllOutcome result={outcome} reason={reason} onClose={onClose} />
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            const missing = runReasonError(reason);
            setError(missing);
            if (missing !== undefined) return;
            setBusy(true);
            void runAll(plans, reason).then((result) => {
              setBusy(false);
              if (result.failures.length === 0) onDone(result);
              else {
                setOutcome(result);
                if (result.launched > 0) onReload();
              }
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
          <p>
            {plural(plans.length, 'plan sera lancé', 'plans seront lancés')} maintenant. Le motif et
            le lancement sont inscrits au journal d’audit.
          </p>
          <div className="button-row dialog-actions">
            <Button variant="secondary" data-safe disabled={busy} onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" busy={busy}>
              Lancer la sauvegarde
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
