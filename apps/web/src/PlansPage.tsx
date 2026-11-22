import { DATA_TYPES, scheduleWindowLabel, type DataType, type RpoHours } from '@backup365/core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  failureBanner,
  createPlan,
  createdMessage,
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
import { splitTitle, type Problem } from './apiError.js';
import { MAX_REASON_LENGTH } from './mail.js';
import { ReasonField } from './RestoreJourney.js';
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
  type Column,
} from './ui/index.js';

const goTo = (hash: string) => {
  window.location.hash = hash;
};

/** Échec d'une action sur les plans : la phrase pour l'utilisateur, sans détail technique. */
export function PlanFailure({ problem }: { problem: Problem }) {
  const tone = problem.code === 'backup_not_configured' ? 'warning' : 'error';
  const { title, text } =
    problem.code === 'backup_not_configured'
      ? splitTitle(problem.message)
      : { title: undefined, text: problem.message };
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
                    aria-describedby={t === 'mail' ? 'data-type-mail-help' : undefined}
                    checked={form.dataTypes.includes(t)}
                    onChange={() => {
                      patch({
                        dataTypes: DATA_TYPES.filter((d) => toggle(form.dataTypes, t).includes(d)),
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
          <h2>Récapitulatif</h2>
          <ResultList rows={recapRows(form)} />
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
          <ReasonField of="du lancement" value={reason} error={error} onChange={setReason} />
          <RunFeedback problem={problem} busy={busy} onClose={onClose} />
        </form>
      )}
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
      {error && <PlanFailure problem={error} />}
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
  mailboxes: readonly Mailbox[],
  runningName: string | undefined,
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
        const view = complianceView(p, runningName);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {view.note && <small className="state-note">{view.note}</small>}
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
        <div className="row-actions">
          <div className="row-actions-buttons">
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
          {(p.running || p.queued) && (
            <small className="state-note" id={`run-hint-${p.id}`}>
              {p.running ? MESSAGES.runBusy : MESSAGES.runAlreadyQueued}
            </small>
          )}
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
  failedOnly = false,
  onRetry,
  onRun,
  onDelete,
}: {
  state: PlansState;
  admin: boolean;
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
        columns={planColumns(admin, mailboxes, state.find((p) => p.running)?.name, {
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
  const [flash, setFlash] = useState<Flash>();
  const [runTarget, setRunTarget] = useState<PlanItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanItem | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchPlans(), fetchMailboxes()]).then(
      ([plans, mailboxes]) => {
        setState(plans);
        setBoxes(mailboxes);
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
        onSubmit={save}
      />
    );
  } else {
    body = (
      <PlansListView
        state={state}
        admin={admin}
        configured={boxes.configured}
        mailboxes={boxes.mailboxes}
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
