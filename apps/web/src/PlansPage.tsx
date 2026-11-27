import type { StatusReport } from '@backup365/core';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  isFailed,
  runFlashText,
  runPlan,
  updatePlan,
  type Mailbox,
  type PlanForm,
  type PlanItem,
  type PlansRoute,
} from './plans.js';
import { type Problem } from './apiError.js';
import {
  connectionView,
  interruptedSince,
  lastKnownRun,
  useConfiguration,
} from './ConfigurationBlock.js';
import { DeleteDialog } from './plans/DeleteDialog.js';
import { PlansListView, type PlansState } from './plans/PlansListView.js';
import { RetentionSimulation } from './plans/RetentionSimulation.js';
import { RunDialog } from './plans/RunDialog.js';
import { goTo } from './plans/goTo.js';
import { PlanWizard } from './plans/wizard/PlanWizard.js';
import { fetchSites } from './sharepoint.js';
import { fetchStatus } from './status.js';
import { RunHaltedAlerts, storageBlocked } from './StorageBlocked.js';
import { Alert, Button, SourcesNav } from './ui/index.js';

type Flash = { tone: 'success' | 'error'; text: string };

// ---- Écran ----------------------------------------------------------------------------------

/** Phrase d'introduction : dit le filtre « plans en échec » (`shown` sur `total`) quand il est actif. */
export function PlansIntro({
  shown,
  total,
}: {
  shown?: number | undefined;
  total?: number | undefined;
}) {
  if (shown === undefined || total === undefined)
    return <p>Ce que chaque plan sauvegarde, et quand.</p>;
  // Tous les plans sont en échec : le filtre ne cache rien, le lien serait inutile.
  if (shown === total)
    return (
      <p>
        Plans en échec : {shown} sur {total}.
      </p>
    );
  return (
    <p>
      Plans en échec : {shown} sur {total}. <a href={PLANS_HASH}>Voir les {total} plans</a>
    </p>
  );
}

/** Écran `#/plans` : liste, parcours de création ou de modification, lancement et suppression. */
export function PlansPage({ route, admin }: { route: PlansRoute; admin: boolean }) {
  const [state, setState] = useState<PlansState>('loading');
  const [boxes, setBoxes] = useState<{ configured: boolean; mailboxes: Mailbox[] }>({
    configured: true,
    mailboxes: [],
  });
  const [sites, setSites] = useState<Mailbox[]>([]);
  const [sources, setSources] = useState<StatusReport | null>(null);
  const [flash, setFlash] = useState<Flash>();
  const [runTarget, setRunTarget] = useState<PlanItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanItem | null>(null);

  // Même lecture de la connexion que l'accueil : configuration et historique des plans (#604).
  const config = useConfiguration(admin);
  const since = interruptedSince(connectionView(admin ? config : 'loading', state));
  // Stockage bloqué (lu sur l'état des sources, administrateur seulement) : traité de même (#612).
  const blocked = storageBlocked(sources);

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
        runBlocked={since !== null || blocked}
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
  const failedShown = Array.isArray(state) ? state.filter(isFailed).length : 0;
  const failedView =
    !wizard &&
    Array.isArray(state) &&
    route.page === 'list' &&
    route.failedOnly === true &&
    failedShown > 0
      ? { shown: failedShown, total: state.length }
      : null;
  return (
    <main tabIndex={-1}>
      <h1>{title}</h1>
      {!wizard && <SourcesNav current="plans" admin={admin} />}
      {!wizard && <RunHaltedAlerts blocked={blocked} since={since} />}
      {!wizard && (
        <div className="view-intro">
          <PlansIntro shown={failedView?.shown} total={failedView?.total} />
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
      {!wizard && admin && Array.isArray(state) && <RetentionSimulation plans={state} />}
      {!wizard && (
        <>
          <RunDialog
            plan={runTarget}
            mailboxes={named}
            since={Array.isArray(state) ? lastKnownRun(state) : null}
            onClose={closeRun}
            onRun={onRun}
          />
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
