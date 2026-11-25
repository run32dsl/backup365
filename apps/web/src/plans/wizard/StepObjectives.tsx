import { type RpoHours } from '@backup365/core';
import {
  JUSTIFICATION_HELP,
  JUSTIFICATION_PLACEHOLDER,
  OBJECTIVE_LABELS,
  RETENTION_CHOICES,
  RPO_CHOICES,
  RTO_CHOICES,
  retentionHelp,
  retentionLabel,
  rpoHelp,
  rtoHelp,
  withCurrent,
  type FormErrors,
  type PlanForm,
} from '../../plans.js';
import { MAX_REASON_LENGTH } from '../../mail.js';
import { ChoiceGroup, FormField } from '../../ui/index.js';

/** Étape 2 : objectifs de point (RPO), de durée (RTO), conservation et justification. */
export function StepObjectives({
  form,
  errors,
  patch,
}: {
  form: PlanForm;
  errors: FormErrors;
  patch: (change: Partial<PlanForm>) => void;
}) {
  return (
    <>
      <ChoiceGroup<RpoHours>
        legend={OBJECTIVE_LABELS.rpo}
        name="rpo"
        value={form.rpoHours}
        options={RPO_CHOICES.map((h) => ({ value: h, label: `${h} h` }))}
        help={rpoHelp(form.rpoHours)}
        onChange={(rpoHours) => {
          patch({ rpoHours });
        }}
      />
      <ChoiceGroup<number>
        legend={OBJECTIVE_LABELS.rto}
        name="rto"
        value={form.rtoHours}
        options={withCurrent(RTO_CHOICES, form.rtoHours).map((h) => ({
          value: h,
          label: `${h} h`,
        }))}
        help={rtoHelp(form.rtoHours)}
        onChange={(rtoHours) => {
          patch({ rtoHours });
        }}
      />
      <ChoiceGroup<number>
        legend={OBJECTIVE_LABELS.retention}
        name="retention"
        value={form.retentionDays}
        options={withCurrent(RETENTION_CHOICES, form.retentionDays).map((d) => ({
          value: d,
          label: retentionLabel(d),
        }))}
        help={retentionHelp(form.retentionDays)}
        onChange={(retentionDays) => {
          patch({ retentionDays });
        }}
      />
      <FormField
        label={`${OBJECTIVE_LABELS.justification} (obligatoire)`}
        type="text"
        name="justification"
        required
        counterMax={MAX_REASON_LENGTH}
        placeholder={JUSTIFICATION_PLACEHOLDER}
        help={JUSTIFICATION_HELP}
        error={errors.justification}
        value={form.justification}
        onChange={(e) => {
          patch({ justification: e.currentTarget.value });
        }}
      />
    </>
  );
}
