import { DATA_TYPES, type DataType, type RpoHours } from '@backup365/core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DATA_TYPE_LABELS,
  MESSAGES,
  NEW_PLAN_HASH,
  PLANS_HASH,
  REASON_CHOICES,
  RETENTION_CHOICES,
  RPO_CHOICES,
  RTO_CHOICES,
  RUN_REASONS,
  complianceView,
  createPlan,
  createdMessage,
  deletePlan,
  editHash,
  emptyForm,
  fetchMailboxes,
  fetchPlans,
  formFromPlan,
  justificationText,
  lastRunLabel,
  planSummary,
  retentionLabel,
  withCurrent,
  retentionHelp,
  rpoHelp,
  rtoHelp,
  rtoSentence,
  runPlan,
  runReasonText,
  summarySentence,
  updatePlan,
  validateStep,
  type FormErrors,
  type Mailbox,
  type PlanForm,
  type PlanItem,
  type PlansRoute,
  type ReasonKind,
} from './plans.js';
import { requestIdOf, type Problem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { AuditReminder, REASON, reasonLabel } from './RestoreJourney.js';
import {
  Alert,
  Button,
  ChoiceGroup,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  StatusPill,
  Steps,
  WIZARD_LABELS,
  WizardActions,
  type Column,
} from './ui/index.js';

const goTo = (hash: string) => {
  window.location.hash = hash;
};

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

/** Liste déroulante native avec libellé relié, aide d'erreur reliée par `aria-describedby`. */
function SelectField({
  id,
  label,
  value,
  placeholder,
  options,
  error,
  help,
  onChange,
}: {
  id: string;
  help?: string;
  label: string;
  value: string;
  placeholder: string;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
          undefined
        }
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && (
        <p id={`${id}-help`} className="field-help">
          {help}
        </p>
      )}
      <ErrorText id={`${id}-error`}>{error}</ErrorText>
    </div>
  );
}

// ---- Parcours en 3 étapes -------------------------------------------------------------------

const STEP_NAMES = ['Quoi protéger', 'Objectifs', 'Récapitulatif'];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Parcours de création et de modification : les saisies restent en mémoire d'une étape à l'autre. */
export function PlanWizard({
  initial,
  editing,
  mailboxes,
  onSubmit,
  initialStep = 1,
}: {
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

  const patch = (change: Partial<PlanForm>) => {
    setForm((f) => ({ ...f, ...change }));
  };
  const next = () => {
    if (step === 3) return;
    const found = validateStep(form, step);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((step + 1) as 2 | 3);
  };
  const submit = async () => {
    setSaving(true);
    setFailure(undefined);
    const problem = await onSubmit(form);
    // En cas de succès la page quitte le parcours : seul l'échec rend la main, saisies conservées.
    setFailure(problem);
    setSaving(false);
  };
  const messages = Object.values(errors);
  const reasonText = justificationText(form.reasonKind || 'other', form.reasonDetail);

  return (
    <form
      className="wizard"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 3) void submit();
        else next();
      }}
    >
      <Steps steps={STEP_NAMES} current={step} titleRef={title} />
      {messages.length > 0 && (
        <Alert tone="error">
          <ul className="error-list">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {failure && <FailureAlert problem={failure} />}

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
                    checked={form.dataTypes.includes(t)}
                    onChange={() => {
                      patch({
                        dataTypes: DATA_TYPES.filter((d) => toggle(form.dataTypes, t).includes(d)),
                      });
                    }}
                  />
                  {DATA_TYPE_LABELS[t]}
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
              { value: 'selection', label: 'Boîtes et comptes choisis' },
            ]}
            onChange={(scope) => {
              patch({ scope });
            }}
          />
          {form.scope === 'selection' && (
            <fieldset
              className="choices"
              aria-describedby={errors.selection ? 'selection-error' : undefined}
            >
              <legend>Boîtes et comptes</legend>
              {mailboxes.length === 0 && <p>Aucune boîte à choisir pour l’instant.</p>}
              <div className="choice-list">
                {mailboxes.map((m) => (
                  <label key={m.id} className="choice">
                    <input
                      type="checkbox"
                      checked={form.selection.includes(m.id)}
                      onChange={() => {
                        patch({ selection: toggle(form.selection, m.id) });
                      }}
                    />
                    {m.displayName}
                  </label>
                ))}
              </div>
              <ErrorText id="selection-error">{errors.selection}</ErrorText>
            </fieldset>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <ChoiceGroup<RpoHours>
            legend="Perte de données acceptable"
            name="rpo"
            value={form.rpoHours}
            options={RPO_CHOICES.map((h) => ({ value: h, label: `${h} h` }))}
            help={rpoHelp(form.rpoHours)}
            onChange={(rpoHours) => {
              patch({ rpoHours });
            }}
          />
          <ChoiceGroup<number>
            legend="Remise en service souhaitée"
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
            legend="Durée de conservation"
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
          <SelectField
            id="reason-kind"
            label="Justification de cette durée *"
            value={form.reasonKind}
            placeholder="Choisir un motif"
            options={REASON_CHOICES}
            error={form.reasonKind === '' ? errors.justification : undefined}
            onChange={(reasonKind) => {
              patch({ reasonKind: reasonKind as ReasonKind | '' });
            }}
          />
          <FormField
            label={
              form.reasonKind === 'other' ? 'Précision (obligatoire)' : 'Précision (facultatif)'
            }
            value={form.reasonDetail}
            maxLength={200}
            error={form.reasonKind === '' ? undefined : errors.justification}
            onChange={(e) => {
              patch({ reasonDetail: e.currentTarget.value });
            }}
          />
          <p>Les durées longues doivent rester justifiées au regard du RGPD.</p>
        </>
      )}

      {step === 3 && (
        <div className="recap">
          <p className="recap-sentence">{summarySentence(form)}</p>
          <p>{rtoSentence(form.rtoHours)}</p>
          <p>{`Justification : ${reasonText.charAt(0).toLowerCase()}${reasonText.slice(1)}.`}</p>
          <p>{MESSAGES.auditTrail}</p>
        </div>
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

function RunDialog({
  plan,
  onClose,
  onRun,
}: {
  plan: PlanItem | null;
  onClose: () => void;
  onRun: (plan: PlanItem, reason: string) => Promise<Problem | undefined>;
}) {
  const [choice, setChoice] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  // Chaque ouverture repart d'un formulaire vide.
  useEffect(() => {
    setChoice('');
    setDetail('');
    setError(undefined);
    setProblem(undefined);
    setBusy(false);
  }, [plan]);
  const missing = choice === '' || (choice === 'Autre (préciser)' && detail.trim() === '');
  return (
    <Dialog
      open={plan !== null}
      title={`Lancer « ${plan?.name ?? ''} » maintenant`}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!plan || busy) return;
          // Une nouvelle tentative efface l'échec précédent : un seul message à la fois.
          setProblem(undefined);
          if (missing) {
            setError(MESSAGES.runReason);
            return;
          }
          setError(undefined);
          setBusy(true);
          void onRun(plan, runReasonText(choice, detail)).then((failure) => {
            setBusy(false);
            setProblem(failure);
          });
        }}
      >
        <SelectField
          id="run-reason"
          label={reasonLabel('du lancement')}
          help={REASON.help}
          value={choice}
          placeholder="Choisir un motif"
          options={RUN_REASONS.map((r) => ({ value: r, label: r }))}
          error={error}
          onChange={setChoice}
        />
        <FormField
          label="Précision (facultatif)"
          value={detail}
          counterMax={REASON.maxLength}
          onChange={(e) => {
            setDetail(e.currentTarget.value);
          }}
        />
        <AuditReminder />
        {problem && <FailureAlert problem={problem} />}
        <div className="button-row dialog-actions">
          <Button variant="secondary" data-safe onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" busy={busy}>
            Lancer la sauvegarde
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  plan,
  onClose,
  onDelete,
}: {
  plan: PlanItem | null;
  onClose: () => void;
  onDelete: (plan: PlanItem) => Promise<Problem | undefined>;
}) {
  const [error, setError] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError(undefined);
    setBusy(false);
  }, [plan]);
  return (
    <Dialog open={plan !== null} title={`Supprimer « ${plan?.name ?? ''} » ?`} onClose={onClose}>
      <p>
        Les sauvegardes existantes sont conservées jusqu’à la fin de leur durée de conservation.
        Aucune nouvelle sauvegarde ne sera faite.
      </p>
      {error && <FailureAlert problem={error} />}
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onClose}>
          Annuler
        </Button>
        <Button
          variant="danger"
          busy={busy}
          onClick={() => {
            if (!plan) return;
            setBusy(true);
            void onDelete(plan).then((failure) => {
              setBusy(false);
              setError(failure);
            });
          }}
        >
          Supprimer le plan
        </Button>
      </div>
    </Dialog>
  );
}

// ---- Liste ----------------------------------------------------------------------------------

export type PlansState = PlanItem[] | 'loading' | 'error';

function planColumns(
  admin: boolean,
  actions: { onRun: (p: PlanItem) => void; onDelete: (p: PlanItem) => void },
): Column<PlanItem>[] {
  const columns: Column<PlanItem>[] = [
    {
      header: 'Plan',
      cell: (p) => (
        <div>
          <span className="nowrap-wide">{p.name}</span>
          <small className="state-note plan-summary">{planSummary(p)}</small>
        </div>
      ),
    },
    {
      header: 'État',
      className: 'compliance-cell',
      cell: (p) => {
        const view = complianceView(p);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {view.note && <small className="state-note">{view.note}</small>}
          </div>
        );
      },
    },
    { header: 'Dernière exécution (UTC)', cell: lastRunLabel },
  ];
  if (admin) {
    columns.push({
      header: 'Actions',
      cell: (p) => (
        <div className="row-actions">
          <Button
            variant="secondary"
            aria-label={`Lancer ${p.name} maintenant`}
            aria-disabled={p.running || undefined}
            onClick={() => {
              if (!p.running) actions.onRun(p);
            }}
          >
            Lancer maintenant
          </Button>
          <div className="row-actions-more">
            <a
              className="btn btn-secondary"
              href={editHash(p.id)}
              aria-label={`Modifier ${p.name}`}
            >
              Modifier
            </a>
            <Button
              variant="danger"
              aria-label={`Supprimer ${p.name}`}
              onClick={() => {
                actions.onDelete(p);
              }}
            >
              Supprimer
            </Button>
          </div>
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
  onRetry,
  loadRequestId,
  onRun,
  onDelete,
}: {
  state: PlansState;
  admin: boolean;
  configured: boolean;
  onRetry: () => void;
  /** Identifiant de la requête qui a échoué au chargement, pour le support. */
  loadRequestId?: string | undefined;
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
        {loadRequestId ? (
          <small className="alert-detail request-id">
            Identifiant de requête : <code>{loadRequestId}</code>
          </small>
        ) : null}
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
  return (
    <>
      {notice}
      {!admin && <p>{MESSAGES.readOnly}</p>}
      <DataTable
        caption="Plans de protection"
        hideCaption
        columns={planColumns(admin, { onRun, onDelete })}
        rows={state}
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
  const [flash, setFlash] = useState<Flash>();
  const [loadRequestId, setLoadRequestId] = useState<string>();
  const [runTarget, setRunTarget] = useState<PlanItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanItem | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchPlans(), fetchMailboxes()]).then(
      ([plans, mailboxes]) => {
        setState(plans);
        setBoxes(mailboxes);
      },
      (e: unknown) => {
        setLoadRequestId(requestIdOf(e));
        setState('error');
      },
    );
  }, []);
  useEffect(load, [load]);
  // Une exécution en cours se suit : la liste se relit tant qu'elle dure.
  const running = Array.isArray(state) && state.some((p) => p.running);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [running, load]);

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
    setFlash({ tone: 'success', text: MESSAGES.runStarted });
    load();
    return undefined;
  };
  const onDelete = async (plan: PlanItem) => {
    const outcome = await deletePlan(plan.id);
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
        loadRequestId={loadRequestId}
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
        loadRequestId={loadRequestId}
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
        onSubmit={save}
      />
    );
  } else {
    body = (
      <PlansListView
        state={state}
        admin={admin}
        configured={boxes.configured}
        onRetry={reloadList}
        loadRequestId={loadRequestId}
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
      <div className="page-header">
        <h1>{title}</h1>
        {!wizard && admin && (
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
      <div aria-live="polite">
        {flash && !wizard && <Alert tone={flash.tone}>{flash.text}</Alert>}
      </div>
      {body}
      {!wizard && (
        <>
          <RunDialog plan={runTarget} onClose={closeRun} onRun={onRun} />
          <DeleteDialog
            plan={deleteTarget}
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
