import { recapRows, type Mailbox, type PlanForm } from '../../plans.js';
import { ResultList } from '../../ui/index.js';

/** Étape 3 : récapitulatif avant l'enregistrement ; `names` nomme les éléments choisis. */
export function StepRecap({ form, names }: { form: PlanForm; names: readonly Mailbox[] }) {
  return <ResultList rows={recapRows(form, names)} />;
}
