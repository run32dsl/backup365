import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MESSAGES,
  NEW_PLAN_HASH,
  PLANS_HASH,
  createPlan,
  createdMessage,
  deletePlan,
  emptyForm,
  fetchMailboxes,
  fetchPlans,
  formFromPlan,
  runFlashText,
  runPlan,
  updatePlan,
  type Mailbox,
  type PlanForm,
  type PlanItem,
  type PlansRoute,
} from './plans.js';
import { type Problem } from './apiError.js';
import { DeleteDialog } from './plans/DeleteDialog.js';
import { PlansListView, type PlansState } from './plans/PlansListView.js';
import { RunDialog } from './plans/RunDialog.js';
import { goTo } from './plans/goTo.js';
import { PlanWizard } from './plans/wizard/PlanWizard.js';
import { Alert, Button, SourcesNav } from './ui/index.js';

type Flash = { tone: 'success' | 'error'; text: string };

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
      {!wizard && <SourcesNav current="plans" admin={admin} />}
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
            mailboxes={boxes.mailboxes}
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
