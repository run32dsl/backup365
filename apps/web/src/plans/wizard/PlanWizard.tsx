import { useEffect, useRef, useState } from 'react';
import { type Problem } from '../../apiError.js';
import {
  MESSAGES,
  PLANS_HASH,
  errorSummary,
  validateStep,
  type FormErrors,
  type Mailbox,
  type PlanForm,
} from '../../plans.js';
import { Alert, Button, Steps, WIZARD_LABELS, WizardActions } from '../../ui/index.js';
import { PlanFailure } from '../PlanFailure.js';
import { goTo } from '../goTo.js';
import { StepObjectives } from './StepObjectives.js';
import { StepRecap } from './StepRecap.js';
import { StepWhat } from './StepWhat.js';

const STEP_NAMES = ['Quoi protéger', 'Objectifs', 'Récapitulatif'];

/** Parcours de création et de modification : les saisies restent en mémoire d'une étape à l'autre. */
export function PlanWizard({
  initial,
  editing,
  mailboxes,
  onSubmit,
  initialStep = 1,
  takenNames = [],
}: {
  /** Noms des autres plans, pour refuser un doublon dès l'étape 1. */
  takenNames?: readonly string[];
  initial: PlanForm;
  editing: boolean;
  mailboxes: Mailbox[];
  /** Renvoie le problème, ou `undefined` si l'enregistrement a réussi. */
  onSubmit: (form: PlanForm) => Promise<Problem | undefined>;
  /** Étape affichée à l'ouverture (tests). */
  initialStep?: 1 | 2 | 3;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Problem>();
  const [saving, setSaving] = useState(false);
  const title = useRef<HTMLParagraphElement>(null);
  const first = useRef(true);
  // Le titre de l'étape reçoit le focus à chaque changement (pas à l'arrivée sur l'écran).
  useEffect(() => {
    if (first.current) first.current = false;
    else title.current?.focus();
  }, [step]);

  const formRef = useRef<HTMLFormElement>(null);
  // Chaque refus de validation relance la mise au point sur le premier champ en erreur.
  const [refusals, setRefusals] = useState(0);
  useEffect(() => {
    if (refusals === 0) return;
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    field.focus({ preventScroll: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    field.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  }, [refusals]);

  const patch = (change: Partial<PlanForm>) => {
    setForm((f) => ({ ...f, ...change }));
  };
  const next = () => {
    if (step === 3) return;
    const found = validateStep(form, step, takenNames);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((step + 1) as 2 | 3);
    else setRefusals((n) => n + 1);
  };
  const submit = async () => {
    setSaving(true);
    setFailure(undefined);
    const problem = await onSubmit(form);
    // En cas de succès la page quitte le parcours : seul l'échec rend la main, saisies conservées.
    if (problem?.code === 'plan_name_taken') {
      // Un nom pris entre-temps : retour à l'étape 1, l'erreur sur le champ Nom.
      setErrors({ name: MESSAGES.nameTaken });
      setStep(1);
      setRefusals((n) => n + 1);
    } else setFailure(problem);
    setSaving(false);
  };
  const messages = Object.values(errors);

  return (
    <form
      ref={formRef}
      className="wizard"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 3) void submit();
        else next();
      }}
    >
      <Steps steps={STEP_NAMES} current={step} titleRef={title} />
      {messages.length > 0 && <Alert tone="error">{errorSummary(messages.length)}</Alert>}
      {failure && <PlanFailure problem={failure} />}

      {step === 1 && <StepWhat form={form} errors={errors} mailboxes={mailboxes} patch={patch} />}
      {step === 2 && <StepObjectives form={form} errors={errors} patch={patch} />}
      {step === 3 && <StepRecap form={form} />}

      <WizardActions
        back={
          step === 1 ? (
            <Button
              variant="secondary"
              onClick={() => {
                goTo(PLANS_HASH);
              }}
            >
              Annuler
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setErrors({});
                setStep((step - 1) as 1 | 2);
              }}
            >
              {WIZARD_LABELS.back}
            </Button>
          )
        }
      >
        {step < 3 ? (
          <Button type="submit">{WIZARD_LABELS.next}</Button>
        ) : (
          <Button type="submit" busy={saving}>
            {editing ? 'Enregistrer les modifications' : 'Créer le plan'}
          </Button>
        )}
      </WizardActions>
    </form>
  );
}
