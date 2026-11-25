import { type RpoHours } from '@backup365/core';
import {
  JUSTIFICATION_HELP,
  JUSTIFICATION_PLACEHOLDER,
  OBJECTIVE_LABELS,
  RETENTION_CHOICES,
  RPO_CHOICES,
  RTO_CHOICES,
  hoursLabel,
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
        options={RPO_CHOICES.map((h) => ({ value: h, label: hoursLabel(h) }))}
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
          label: hoursLabel(h),
        }))}
        help={rtoHelp(form.rtoHours)}
        onChange={(rtoHours) => {
          patch({ rtoHours });
        }}
      />
      <div className="field">
        <label htmlFor="retention">{OBJECTIVE_LABELS.retention}</label>
        <div className="field-control">
          <select
            id="retention"
            name="retention"
            value={form.retentionDays}
            aria-describedby="retention-help"
            onChange={(e) => {
              patch({ retentionDays: Number(e.currentTarget.value) });
            }}
          >
            {withCurrent(RETENTION_CHOICES, form.retentionDays).map((d) => (
              <option key={d} value={d}>
                {retentionLabel(d)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-meta">
          <p id="retention-help" className="field-help">
            {retentionHelp(form.retentionDays)}
          </p>
        </div>
      </div>
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
