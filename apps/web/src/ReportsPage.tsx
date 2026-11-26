import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { requestIdOf } from './apiError.js';
import {
  REPORT_LABELS as L,
  fetchReports,
  lastSendSentence,
  recheckMailer,
  recipientsError,
  saveReports,
  sendTestReport,
  testSentMessage,
  type ReportSettings,
  type ReportsView,
} from './reports.js';
import { MailerNotice } from './reports/MailerNotice.js';
import { ReportsForm, type ReportDraft, type TestResult } from './reports/ReportsForm.js';
import { ReportsRecap } from './reports/ReportsRecap.js';
import { UNREACHABLE } from './session.js';
import { Alert, Button, SettingsNav } from './ui/index.js';

const draftOf = (s: ReportSettings): ReportDraft => ({
  recipients: [...s.recipients],
  frequency: s.frequency,
  failureAlert: s.failureAlert,
});

/** Dernier envoi : une phrase (nature et date) puis le résultat, jamais la couleur seule. */
export function LastSendStatus({ view }: { view: ReportsView }) {
  const send = view.lastSend;
  if (!send) return <p className="field-help">Aucun rapport envoyé pour l’instant.</p>;
  return (
    <p className="field-help">
      {lastSendSentence(send)}{' '}
      <span className={`badge badge-${send.ok ? 'ok' : 'err'}`}>
        <span aria-hidden="true">{send.ok ? '✔' : '✖'}</span> {send.ok ? 'Envoyé' : 'En échec'}
      </span>
    </p>
  );
}

/** Réglages, vue « Rapports par mail » (`#/rapports`, administrateurs) : régler, essayer, vérifier, enregistrer. */
export function ReportsPage() {
  const [view, setView] = useState<ReportsView | 'loading' | 'error'>('loading');
  const [requestId, setRequestId] = useState<string>();
  const [draft, setDraft] = useState<ReportDraft>({
    recipients: [],
    frequency: 'weekly',
    failureAlert: true,
  });
  const [step, setStep] = useState<'edit' | 'recap'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'check' | null>(null);
  const [test, setTest] = useState<TestResult>(null);
  const [saved, setSaved] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const load = useCallback((keepDraft = false) => {
    fetchReports().then(
      (v) => {
        setView(v);
        if (!keepDraft) setDraft(draftOf(v.settings));
      },
      (e: unknown) => {
        setRequestId(requestIdOf(e));
        setView('error');
      },
    );
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (view === 'loading' || view === 'error') {
    return (
      <main tabIndex={-1}>
        <h1>Réglages</h1>
        <SettingsNav current="reports" />
        <h2 className="sr-only">Rapports par mail</h2>
        {view === 'loading' ? (
          <p role="status">Chargement des réglages…</p>
        ) : (
          <Alert
            tone="error"
            action={
              <Button
                onClick={() => {
                  setView('loading');
                  load();
                }}
              >
                Réessayer
              </Button>
            }
          >
            Impossible d’afficher les rapports par mail.
            {requestId && <small className="alert-detail">Référence : {requestId}</small>}
          </Alert>
        )}
      </main>
    );
  }

  const recipients = draft.recipients;
  const settings: ReportSettings = { ...draft, recipients };
  // Vider la liste désactive les rapports, mais seulement s'il y avait déjà des destinataires.
  const check = (required: boolean) => {
    const message = recipientsError(recipients, required);
    setError(message);
    if (message) field.current?.focus();
    return message === null;
  };
  const onTest = () => {
    setTest(null);
    if (!check(true)) return;
    setBusy('test');
    sendTestReport(recipients, draft.frequency)
      .then(
        (out) => {
          setTest(
            out.ok
              ? { ok: true, text: testSentMessage(recipients, out.at) }
              : { ok: false, text: out.message },
          );
          load(true);
        },
        () => {
          setTest({ ok: false, text: UNREACHABLE });
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };
  const onContinue = () => {
    setSaved(false);
    if (check(view.settings.recipients.length === 0)) setStep('recap');
  };
  const onSave = () => {
    setBusy('save');
    setSaveError(null);
    saveReports(settings)
      .then(
        (out) => {
          if (!out.ok) {
            setSaveError(out.message);
            return;
          }
          setSaved(true);
          setStep('edit');
          load();
        },
        () => {
          setSaveError(UNREACHABLE);
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };
  const onRecheck = () => {
    setBusy('check');
    setCheckError(null);
    recheckMailer()
      .then(
        (out) => {
          if (out.ok) setView({ ...view, mailer: out.value.mailer });
          else setCheckError(`La vérification a échoué. ${out.message}`);
        },
        () => {
          setCheckError(UNREACHABLE);
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <ReportsLayout
      view={view}
      checking={busy === 'check'}
      checkError={checkError}
      saved={saved}
      onRecheck={onRecheck}
    >
      {step === 'edit' ? (
        <ReportsForm
          draft={draft}
          error={error}
          testing={busy === 'test'}
          test={test}
          field={field}
          onChange={(next) => {
            setSaved(false);
            setError(null);
            setDraft(next);
          }}
          onTest={onTest}
          onContinue={onContinue}
        />
      ) : (
        <ReportsRecap
          settings={settings}
          plans={view.plans}
          saving={busy === 'save'}
          error={saveError}
          onSave={onSave}
          onEdit={() => {
            setStep('edit');
          }}
        />
      )}
    </ReportsLayout>
  );
}

/** Cadre de la vue : les réglages (`children`) n'apparaissent qu'une fois l'envoi prêt. */
export function ReportsLayout({
  view,
  checking,
  checkError,
  saved,
  onRecheck,
  children,
}: {
  view: ReportsView;
  checking: boolean;
  checkError: string | null;
  saved: boolean;
  onRecheck: () => void;
  children: ReactNode;
}) {
  return (
    <main tabIndex={-1} className="reports-view">
      <h1>Réglages</h1>
      <SettingsNav current="reports" />
      <h2 className="sr-only">Rapports par mail</h2>
      <p>{L.intro}</p>
      <MailerNotice mailer={view.mailer} checking={checking} onRecheck={onRecheck} />
      {checkError && <Alert tone="error">{checkError}</Alert>}
      <div role="status">{saved && <Alert tone="success">{L.saved}</Alert>}</div>
      {view.mailer.state === 'ready' && children}
      <LastSendStatus view={view} />
    </main>
  );
}
