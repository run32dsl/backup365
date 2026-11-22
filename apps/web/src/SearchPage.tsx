import { useEffect, useState, type FormEvent } from 'react';
import {
  mailHref,
  initialSearchQuery,
  searchMails,
  searchQueryFromForm,
  type SearchQuery,
  type SearchResponse,
} from './mail.js';
import {
  DATE_HELP,
  FILTER_NOT_APPLIED,
  hasDateError,
  submitFilters,
  type DateRange,
} from './audit.js';
import { dateTimeOf, folderLabel, plural } from './format.js';
import { AuditReminder } from './RestoreJourney.js';
import { RestoreAction, RestoreNotConfigured } from './RestoreAction.js';
import { fetchRestoreConfigured } from './restore.js';
import {
  Address,
  Alert,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Pager,
  type Column,
} from './ui/index.js';

/** État de la recherche. */
export type SearchState = SearchResponse | 'loading' | 'error';

type Hit = SearchResponse['items'][number];

const MAILBOX_COLUMN: Column<Hit> = {
  header: 'Boîte',
  className: 'keep-words col-mailbox mail-meta',
  cell: (m) => <Address value={m.mailboxId} />,
};

const COLUMNS: Column<Hit>[] = [
  {
    header: 'Date (UTC)',
    className: 'mail-meta mail-date',
    cell: (m) => <span className="nowrap">{dateTimeOf(m.date)}</span>,
  },
  {
    header: 'Expéditeur',
    className: 'keep-words address card-nolabel',
    cell: (m) => <Address value={m.sender} />,
  },
  {
    header: 'Objet',
    className: 'subject card-title mail-subject',
    cell: (m) => {
      const subject = m.subject === '' ? '(sans objet)' : m.subject;
      return (
        <a href={mailHref(m)} title={subject}>
          {subject}
        </a>
      );
    },
  },
  MAILBOX_COLUMN,
  {
    header: 'Dossier',
    className: 'nowrap mail-meta mail-folder',
    cell: (m) => folderLabel(m.folder),
  },
];

export const SEARCH_HELP =
  'Cherchez un mail par objet ou expéditeur, dans une boîte et sur une période, puis ouvrez-le pour le restaurer ou l’exporter.';
export const SEARCH_START = 'Lancez une recherche pour afficher les mails sauvegardés.';

/** Phrase de l'état « sans résultat » : rappelle les critères et propose d'élargir. */
export function noResultText(query?: SearchQuery): string {
  const what = query?.q ? `« ${query.q} »` : 'cette recherche';
  const period =
    query?.after || query?.before ? 'dans cette période' : 'sur la période sauvegardée';
  return `Aucun mail ne correspond à ${what} ${period}. Élargissez la période ou retirez le filtre de boîte.`;
}

const RESTORE_HINT_ID = 'restore-not-configured';

/**
 * Résultats de recherche : métadonnées seulement, chaque ligne mène à la fiche du mail. Avec
 * `restoreConfigured`, chaque ligne propose « Restaurer » (désactivé si la restauration est indisponible).
 */
export function SearchView({
  state,
  restoreConfigured,
  onPage,
  mailbox,
  filterRefused = false,
  query,
}: {
  /** Critères saisis : l'état vide les reprend pour suggérer d'élargir la recherche. */
  query?: SearchQuery;
  state: SearchState;
  /** Un filtre de date refusé n'a pas été appliqué : la liste affichée n'est pas filtrée. */
  filterRefused?: boolean;
  /** Boîte filtrée : la colonne « Boîte » disparaît et la boîte est rappelée dans le compteur. */
  mailbox?: string;
  restoreConfigured?: boolean;
  onPage?: (offset: number) => void;
}) {
  if (state === 'loading') return <p role="status">Recherche en cours…</p>;
  if (state === 'error') return <Alert tone="error">Recherche indisponible</Alert>;
  const notice = filterRefused && <Alert tone="info">{FILTER_NOT_APPLIED}</Alert>;
  if (state.items.length === 0)
    return (
      <>
        {notice}
        <EmptyState>{noResultText(query)}</EmptyState>
      </>
    );
  const base = mailbox ? COLUMNS.filter((c) => c !== MAILBOX_COLUMN) : COLUMNS;
  const columns: Column<Hit>[] =
    restoreConfigured === undefined
      ? base
      : [
          ...base,
          {
            header: 'Action',
            className: 'card-action',
            cell: (m) => (
              <RestoreAction
                mail={m}
                configured={restoreConfigured}
                hintId={RESTORE_HINT_ID}
                variant="secondary"
              />
            ),
          },
        ];
  return (
    <>
      {notice}
      <p role="status">
        {plural(state.total, 'résultat')}
        {mailbox ? ` dans la boîte ${mailbox}` : ''}, {state.offset + 1} à{' '}
        {state.offset + state.items.length}
      </p>
      {restoreConfigured === false && <RestoreNotConfigured id={RESTORE_HINT_ID} />}
      <DataTable
        caption="Résultats de la recherche"
        hideCaption
        columns={columns}
        rows={state.items}
        rowKey={(m) => `${m.mailboxId}/${m.messageId}`}
      />
      <Pager offset={state.offset} limit={state.limit} total={state.total} onPage={onPage} />
    </>
  );
}

/** Écran de recherche : champ libre, boîte, plage de dates, résultats paginés. */
export function SearchPage({ mailbox }: { mailbox?: string }) {
  const [query, setQuery] = useState<SearchQuery | null>(initialSearchQuery(mailbox));
  const [state, setState] = useState<SearchState | null>(null);
  const [restoreConfigured, setRestoreConfigured] = useState<boolean | undefined>();
  useEffect(() => {
    let current = true;
    void fetchRestoreConfigured().then((configured) => {
      if (current) setRestoreConfigured(configured);
    });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!query) return;
    let current = true;
    setState('loading');
    searchMails(query).then(
      (r) => current && setState(r),
      () => current && setState('error'),
    );
    return () => {
      current = false;
    };
  }, [query]);

  const [errors, setErrors] = useState<DateRange>({ from: '', to: '' });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { errors, query } = submitFilters(form, 'after', 'before', searchQueryFromForm);
    setErrors(errors);
    if (query) setQuery(query);
  }

  return (
    <main tabIndex={-1}>
      <h1>Restaurer depuis la messagerie</h1>
      <p className="page-help">{SEARCH_HELP}</p>
      <AuditReminder />
      <form onSubmit={submit} className="filters">
        <FormField label="Recherche" type="search" name="q" maxLength={256} />
        <FormField
          label="Boîte"
          type="text"
          name="mailbox"
          maxLength={256}
          defaultValue={mailbox}
        />
        <FormField
          label="Du"
          type="text"
          name="after"
          maxLength={10}
          help={DATE_HELP}
          error={errors.fromError}
        />
        <FormField
          label="Au"
          type="text"
          name="before"
          maxLength={10}
          help={DATE_HELP}
          error={errors.toError}
        />
        <Button type="submit">Rechercher</Button>
      </form>
      {state === null && query === null && <EmptyState>{SEARCH_START}</EmptyState>}
      {state !== null && (
        <SearchView
          state={state}
          query={query ?? undefined}
          restoreConfigured={restoreConfigured}
          mailbox={query?.mailbox}
          filterRefused={hasDateError(errors)}
          onPage={(offset) => {
            if (query) setQuery({ ...query, offset });
          }}
        />
      )}
    </main>
  );
}
