import { recapRows, type PlanForm } from '../../plans.js';
import { ResultList } from '../../ui/index.js';

/** Étape 3 : récapitulatif avant l'enregistrement. */
export function StepRecap({ form }: { form: PlanForm }) {
  return (
    <>
      <h2>Récapitulatif</h2>
      <ResultList rows={recapRows(form)} />
    </>
  );
}
