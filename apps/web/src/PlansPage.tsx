import { DATA_TYPES, scheduleWindowLabel, type DataType, type RpoHours } from '@backup365/core';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfigurationLink } from './ConfigurationBlock.js';
import {
  DATA_TYPE_LABELS,
  MAIL_HELP,
  MESSAGES,
  NEW_PLAN_HASH,
  PLANS_HASH,
  JUSTIFICATION_HELP,
  JUSTIFICATION_PLACEHOLDER,
  RETENTION_CHOICES,
  RPO_CHOICES,
  RTO_CHOICES,
  complianceView,
  type SourcesReport,
  failureBanner,
  createPlan,
  createdMessage,
  errorSummary,
  deletePlan,
  editHash,
  emptyForm,
  fetchMailboxes,
  fetchPlans,
  formFromPlan,
  isFailed,
  lastRunLabel,
  planSummary,
  runFlashText,
  retentionLabel,
  withCurrent,
  retentionHelp,
  rpoHelp,
  rtoHelp,
  OBJECTIVE_LABELS,
  recapRows,
  runPlan,
  runReasonError,
  updatePlan,
  validateStep,
  type FormErrors,
  type Mailbox,
  type PlanForm,
  type PlanItem,
  type PlansRoute,
} from './plans.js';
import { fetchStatus } from './status.js';
import { problemMessage, splitTitle, type Problem } from './apiError.js';
import { fetchSites } from './sharepoint.js';
import { useAdmin } from './role.js';
import { MAX_REASON_LENGTH } from './mail.js';
import { REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import {
  Alert,
  Button,
  ChoiceGroup,
  DataTable,
  Dialog,
  ResultList,
  EmptyState,
  FormField,
  StatusPill,
  Steps,
  WIZARD_LABELS,
  WizardActions,
  SourcesNav,
  type Column,
} from './ui/index.js';

const goTo = (hash: string) => {
  window.location.hash = hash;
};

/** Échec d'une action sur les plans : la phrase pour l'utilisateur, sans détail technique. */
export function PlanFailure({ problem }: { problem: Problem }) {
  const message = problemMessage(problem, useAdmin());
  const tone = problem.code === 'backup_not_configured' ? 'warning' : 'error';
  const { title, text } =
    problem.code === 'backup_not_configured'
      ? splitTitle(message)
      : { title: undefined, text: message };
  return (
    <Alert tone={tone} {...(title ? { title } : {})}>
      {text}
      {problem.code === 'backup_not_configured' ? <ConfigurationLink /> : null}
    </Alert>
  );
}

type Flash = { tone: 'success' | 'error'; text: string };

// ---- Champs communs -------------------------------------------------------------------------

function ErrorText({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="field-error">
      <span aria-hidden="true">✖</span> {children}
    </p>
  );
}

// ---- Parcours en 3 étapes -------------------------------------------------------------------

const STEP_NAMES = ['Quoi protéger', 'Objectifs', 'Récapitulatif'];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Groupe de cases d'un service dans le périmètre choisi (mêmes `.choice` que les données). */
function SelectionGroup({
  legend,
  empty,
  items,
  selection,
  invalid,
  onToggle,
}: {
  legend: string;
  empty: string;
  items: readonly Mailbox[];
  selection: readonly string[];
  invalid: true | undefined;
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="choices" aria-describedby={invalid ? 'selection-error' : undefined}>
      <legend>{legend}</legend>
      {items.length === 0 && <p>{empty}</p>}
      <div className="choice-list">
        {items.map((m) => (
          <label key={m.id} className="choice">
            <input
              type="checkbox"
              aria-invalid={invalid}
              aria-describedby={invalid ? 'selection-error' : undefined}
              checked={selection.includes(m.id)}
              onChange={() => {
                onToggle(m.id);
              }}
            />
            {m.displayName}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Parcours de création et de modification : les saisies restent en mémoire d'une étape à l'autre. */
export function PlanWizard({
  initial,
  editing,
  mailboxes,
  sites = [],
  onSubmit,
  initialStep = 1,
  takenNames = [],
}: {
  /** Noms des autres plans, pour refuser un doublon dès l'étape 1. */
  takenNames?: readonly string[];
  initial: PlanForm;
  editing: boolean;
  mailboxes: Mailbox[];
  /** Sites SharePoint sauvegardables, proposés quand SharePoint est coché. */
  sites?: Mailbox[];
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
  const invalid = (key: keyof FormErrors) => (errors[key] ? true : undefined);

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

      {step === 1 && (
        <>
          <FormField
            label="Nom du plan"
            value={form.name}
            maxLength={100}
            autoComplete="off"
            error={errors.name}
            onChange={(e) => {
              patch({ name: e.currentTarget.value });
            }}
          />
          <fieldset
            className="choices"
            aria-describedby={errors.dataTypes ? 'data-types-error' : undefined}
          >
            <legend>Données à sauvegarder</legend>
            <div className="choice-row">
              {DATA_TYPES.map((t: DataType) => (
                <label key={t} className="choice">
                  <input
                    type="checkbox"
                    aria-invalid={invalid('dataTypes')}
                    aria-describedby={
                      [
                        t === 'mail' ? 'data-type-mail-help' : '',
                        errors.dataTypes ? 'data-types-error' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    checked={form.dataTypes.includes(t)}
                    onChange={() => {
                      const dataTypes = DATA_TYPES.filter((d) =>
                        toggle(form.dataTypes, t).includes(d),
                      );
                      // Un groupe qui disparaît emporte ses choix ; les ids inconnus du catalogue restent.
                      const hidden = new Set<string>([
                        ...(dataTypes.some((d) => d !== 'sharepoint') ? [] : mailboxes).map(
                          (m) => m.id,
                        ),
                        ...(dataTypes.includes('sharepoint') ? [] : sites).map((s) => s.id),
                      ]);
                      patch({
                        dataTypes,
                        selection: form.selection.filter((id) => !hidden.has(id)),
                      });
                    }}
                  />
                  {DATA_TYPE_LABELS[t]}
                  {t === 'mail' && (
                    <small id="data-type-mail-help" className="state-note">
                      {MAIL_HELP}
                    </small>
                  )}
                </label>
              ))}
            </div>
            <ErrorText id="data-types-error">{errors.dataTypes}</ErrorText>
          </fieldset>
          <ChoiceGroup
            legend="Périmètre"
            name="scope"
            value={form.scope}
            options={[
              { value: 'all', label: 'Toute l’organisation' },
              { value: 'selection', label: 'Boîtes, comptes et sites choisis' },
            ]}
            onChange={(scope) => {
              patch({ scope });
            }}
          />
          {form.scope === 'selection' && (
            <>
              {form.dataTypes.some((t) => t !== 'sharepoint') && (
                <SelectionGroup
                  legend="Boîtes et comptes"
                  empty="Aucune boîte à choisir pour l’instant."
                  items={mailboxes}
                  selection={form.selection}
                  invalid={invalid('selection')}
                  onToggle={(id) => {
                    patch({ selection: toggle(form.selection, id) });
                  }}
                />
              )}
              {form.dataTypes.includes('sharepoint') && (
                <SelectionGroup
                  legend="Sites SharePoint"
                  empty="Aucun site à choisir pour l’instant."
                  items={sites}
                  selection={form.selection}
                  invalid={invalid('selection')}
                  onToggle={(id) => {
                    patch({ selection: toggle(form.selection, id) });
                  }}
                />
              )}
              <ErrorText id="selection-error">{errors.selection}</ErrorText>
            </>
          )}
        </>
      )}

      {step === 2 && (
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
      )}

      {step === 3 && (
        <>
          <ResultList rows={recapRows(form, [...mailboxes, ...sites])} />
        </>
      )}

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

// ---- Dialogues ------------------------------------------------------------------------------

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

function RunDialog({
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
      <p>
        Plan : <strong>{plan.name}</strong>
        <small className="state-note plan-summary">{planSummary(plan, mailboxes)}</small>
      </p>
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

function DeleteDialog({
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
    <Dialog open={plan !== null} title={`Supprimer « ${plan?.name ?? ''} » ?`} onClose={onClose}>
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

// ---- Liste ----------------------------------------------------------------------------------

export type PlansState = PlanItem[] | 'loading' | 'error';

function planColumns(
  admin: boolean,
  mailboxes: readonly Mailbox[],
  runningName: string | undefined,
  sources: SourcesReport | null,
  actions: { onRun: (p: PlanItem) => void; onDelete: (p: PlanItem) => void },
): Column<PlanItem>[] {
  const columns: Column<PlanItem>[] = [
    {
      header: 'Plan',
      className: 'card-title',
      cell: (p) => (
        <div>
          <span className="nowrap-wide">{p.name}</span>
          <small className="state-note plan-summary">{planSummary(p, mailboxes)}</small>
          {scheduleWindowLabel(p.rpoHours) && (
            <small className="state-note plan-summary">{scheduleWindowLabel(p.rpoHours)}</small>
          )}
        </div>
      ),
    },
    {
      header: 'État',
      className: 'compliance-cell card-nolabel',
      cell: (p) => {
        const view = complianceView(p, runningName, sources);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {view.note && <small className="state-note">{view.note}</small>}
            {view.seeSources && (
              <a className="state-link" href="#/sources">
                Voir les sources
              </a>
            )}
          </div>
        );
      },
    },
    {
      header: 'Dernière exécution (UTC)',
      className: 'card-wide plan-last-run',
      cell: lastRunLabel,
    },
  ];
  if (admin) {
    columns.push({
      header: 'Actions',
      className: 'card-action',
      cell: (p) => (
        <div className="button-row row-actions">
          <Button
            variant="secondary"
            aria-label={`Lancer ${p.name} maintenant`}
            aria-disabled={p.running || p.queued || undefined}
            aria-describedby={p.running || p.queued ? `run-hint-${p.id}` : undefined}
            onClick={() => {
              if (!p.running && !p.queued) actions.onRun(p);
            }}
          >
            Lancer maintenant
          </Button>
          {(p.running || p.queued) && (
            <small className="state-note" id={`run-hint-${p.id}`}>
              {p.running ? MESSAGES.runBusy : MESSAGES.runAlreadyQueued}
            </small>
          )}
          <a
            className="btn btn-secondary action-half"
            href={editHash(p.id)}
            aria-label={`Modifier ${p.name}`}
          >
            Modifier
          </a>
          <Button
            variant="danger"
            className="action-half"
            aria-label={`Supprimer ${p.name}`}
            onClick={() => {
              actions.onDelete(p);
            }}
          >
            Supprimer
          </Button>
        </div>
      ),
    });
  }
  return columns;
}

/** Liste des plans et ses états (chargement, erreur, vide, non configuré, lecture seule). */
export function PlansListView({
  state,
  admin,
  configured,
  mailboxes = [],
  sources = null,
  failedOnly = false,
  onRetry,
  onRun,
  onDelete,
}: {
  state: PlansState;
  admin: boolean;
  /** Rapport d'état des sources : un plan en retard y nomme ses sources en retard. */
  sources?: SourcesReport | null;
  /** Réduit la liste aux plans en échec (s'il y en a) ; un lien rend la liste entière. */
  failedOnly?: boolean;
  mailboxes?: readonly Mailbox[];
  configured: boolean;
  onRetry: () => void;
  onRun: (p: PlanItem) => void;
  onDelete: (p: PlanItem) => void;
}) {
  if (state === 'loading') {
    return (
      <div aria-busy="true">
        <p role="status" aria-live="polite">
          {MESSAGES.loading}
        </p>
        <div className="skeleton" aria-hidden="true" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <Alert
        tone="error"
        action={
          <Button variant="secondary" onClick={onRetry}>
            Réessayer
          </Button>
        }
      >
        {MESSAGES.loadError}
      </Alert>
    );
  }
  const notice: ReactNode = !configured && (
    <EmptyState
      action={
        admin ? (
          <Button
            variant="secondary"
            onClick={() => {
              goTo('#/');
            }}
          >
            Configurer la sauvegarde
          </Button>
        ) : undefined
      }
    >
      <strong>{MESSAGES.notConfigured}</strong>
      <br />
      {admin ? MESSAGES.notConfiguredHelp : MESSAGES.notConfiguredOperator}
    </EmptyState>
  );
  if (state.length === 0) {
    if (notice) return <>{notice}</>;
    return (
      <EmptyState
        action={
          admin ? (
            <Button
              onClick={() => {
                goTo(NEW_PLAN_HASH);
              }}
            >
              Créer un plan
            </Button>
          ) : undefined
        }
      >
        <strong>{MESSAGES.emptyTitle}</strong>
        <br />
        {admin ? MESSAGES.emptyAdmin : MESSAGES.emptyOperator}
      </EmptyState>
    );
  }
  const failed = state.filter(isFailed);
  const filtered = failedOnly && failed.length > 0;
  return (
    <>
      {notice}
      {!admin && <p>{MESSAGES.readOnly}</p>}
      {filtered && (
        <>
          {failed.map((p) => {
            const banner = failureBanner(p, admin);
            const busy = p.running || p.queued;
            return (
              <Alert
                key={p.id}
                tone="error"
                title={banner.title}
                action={
                  admin ? (
                    <Button
                      aria-label={`Lancer ${p.name} maintenant`}
                      aria-disabled={busy || undefined}
                      aria-describedby={busy ? `banner-run-hint-${p.id}` : undefined}
                      onClick={() => {
                        if (!busy) onRun(p);
                      }}
                    >
                      Lancer maintenant
                    </Button>
                  ) : undefined
                }
              >
                {[banner.cause, banner.consequence, banner.advice].filter(Boolean).join(' ')}
                {busy && (
                  <small className="state-note" id={`banner-run-hint-${p.id}`}>
                    {p.running ? MESSAGES.runBusy : MESSAGES.runAlreadyQueued}
                  </small>
                )}
              </Alert>
            );
          })}
          <p>
            <a href={PLANS_HASH}>Voir tous les plans</a>
          </p>
        </>
      )}
      <DataTable
        caption="Plans de protection"
        hideCaption
        columns={planColumns(admin, mailboxes, state.find((p) => p.running)?.name, sources, {
          onRun,
          onDelete,
        })}
        rows={filtered ? failed : state}
        rowKey={(p) => p.id}
      />
    </>
  );
}

// ---- Écran ----------------------------------------------------------------------------------

/** Écran `#/plans` : liste, parcours de création ou de modification, lancement et suppression. */
export function PlansPage({ route, admin }: { route: PlansRoute; admin: boolean }) {
  const [state, setState] = useState<PlansState>('loading');
  const [boxes, setBoxes] = useState<{ configured: boolean; mailboxes: Mailbox[] }>({
    configured: true,
    mailboxes: [],
  });
  const [sites, setSites] = useState<Mailbox[]>([]);
  const [sources, setSources] = useState<SourcesReport | null>(null);
  const [flash, setFlash] = useState<Flash>();
  const [runTarget, setRunTarget] = useState<PlanItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanItem | null>(null);

  const named = useMemo(() => [...boxes.mailboxes, ...sites], [boxes.mailboxes, sites]);
  const load = useCallback(() => {
    // L'état des sources nomme ce qui est en retard ; sans lui, la liste reste lisible.
    const status = fetchStatus().catch(() => null);
    Promise.all([fetchPlans(), fetchMailboxes(), fetchSites(), status]).then(
      ([plans, mailboxes, found, report]) => {
        setSources(report);
        setState(plans);
        setBoxes(mailboxes);
        setSites(found.status === 'ok' ? found.data : []);
      },
      () => {
        setState('error');
      },
    );
  }, []);
  useEffect(load, [load]);
  // Une exécution en cours se suit : la liste se relit tant qu'elle dure.
  const running = Array.isArray(state) && state.some((p) => p.running || p.queued);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [running, load]);

  // La confirmation reçoit le focus à son apparition, comme le veut la maquette (#166).
  const flashRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash && route.page === 'list') flashRef.current?.focus();
  }, [flash, route.page]);

  const wizardOpen = route.page !== 'list';
  // Un message de succès ne survit pas à l'ouverture d'un parcours.
  useEffect(() => {
    if (wizardOpen) setFlash(undefined);
  }, [wizardOpen]);

  const reloadList = () => {
    setState('loading');
    load();
  };

  const closeRun = () => {
    setRunTarget(null);
  };
  const onRun = async (plan: PlanItem, reason: string) => {
    const outcome = await runPlan(plan.id, reason);
    if (!outcome.ok) return outcome;
    setRunTarget(null);
    setFlash({
      tone: 'success',
      text: runFlashText(outcome.value.queued, plan.name, Array.isArray(state) ? state : undefined),
    });
    load();
    return undefined;
  };
  const onDelete = async (plan: PlanItem, reason: string) => {
    const outcome = await deletePlan(plan.id, reason);
    if (!outcome.ok) return outcome;
    setDeleteTarget(null);
    setFlash({ tone: 'success', text: MESSAGES.deleted });
    load();
    return undefined;
  };

  const editing = route.page === 'edit' ? route.id : undefined;
  const plan = Array.isArray(state) && editing ? state.find((p) => p.id === editing) : undefined;
  const wizard = route.page !== 'list';

  const save = async (form: PlanForm): Promise<Problem | undefined> => {
    if (editing) {
      const outcome = await updatePlan(editing, form);
      if (!outcome.ok) return outcome;
      setFlash({ tone: 'success', text: MESSAGES.updated });
    } else {
      const outcome = await createPlan(form);
      if (!outcome.ok) return outcome;
      setFlash({ tone: 'success', text: createdMessage(outcome.value) });
    }
    load();
    goTo(PLANS_HASH);
    return undefined;
  };

  let body: ReactNode;
  if (wizard && !admin) {
    body = <Alert tone="error">{MESSAGES.forbidden}</Alert>;
  } else if (wizard && !boxes.configured && state !== 'loading' && state !== 'error') {
    body = (
      <PlansListView
        state={[]}
        admin={admin}
        configured={false}
        onRetry={reloadList}
        onRun={setRunTarget}
        onDelete={setDeleteTarget}
      />
    );
  } else if (wizard && (state === 'loading' || state === 'error')) {
    body = (
      <PlansListView
        state={state}
        admin={admin}
        configured
        onRetry={reloadList}
        onRun={setRunTarget}
        onDelete={setDeleteTarget}
      />
    );
  } else if (editing && !plan) {
    body = <Alert tone="error">Ce plan n’existe plus.</Alert>;
  } else if (wizard) {
    body = (
      <PlanWizard
        key={editing ?? 'new'}
        initial={plan ? formFromPlan(plan) : emptyForm()}
        editing={editing !== undefined}
        mailboxes={boxes.mailboxes}
        sites={sites}
        takenNames={
          Array.isArray(state) ? state.filter((p) => p.id !== editing).map((p) => p.name) : []
        }
        onSubmit={save}
      />
    );
  } else {
    body = (
      <PlansListView
        state={state}
        admin={admin}
        configured={boxes.configured}
        mailboxes={named}
        sources={sources}
        failedOnly={route.page === 'list' && route.failedOnly === true}
        onRetry={reloadList}
        onRun={setRunTarget}
        onDelete={setDeleteTarget}
      />
    );
  }

  const title = !wizard
    ? 'Plans de protection'
    : editing
      ? 'Modifier le plan'
      : 'Créer un plan de protection';
  const canCreate = admin && boxes.configured;
  return (
    <main tabIndex={-1}>
      <h1>{title}</h1>
      {!wizard && <SourcesNav current="plans" admin={admin} />}
      {!wizard && (
        <div className="view-intro">
          <p>Ce que chaque plan sauvegarde, et quand.</p>
          {admin && (
            <Button
              aria-disabled={!canCreate || undefined}
              onClick={() => {
                if (canCreate) goTo(NEW_PLAN_HASH);
              }}
            >
              <span aria-hidden="true">+ </span>
              Créer un plan
            </Button>
          )}
        </div>
      )}
      <div aria-live="polite">
        {flash && !wizard && (
          <Alert tone={flash.tone} focusRef={flashRef}>
            {flash.text}
          </Alert>
        )}
      </div>
      {body}
      {!wizard && (
        <>
          <RunDialog plan={runTarget} onClose={closeRun} onRun={onRun} />
          <DeleteDialog
            plan={deleteTarget}
            mailboxes={named}
            onClose={() => {
              setDeleteTarget(null);
            }}
            onDelete={onDelete}
          />
        </>
      )}
    </main>
  );
}
