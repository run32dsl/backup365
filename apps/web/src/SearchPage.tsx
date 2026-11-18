import { useEffect, useState, type FormEvent } from 'react';
import {
  mailHref,
  searchMails,
  searchQueryFromForm,
  type SearchQuery,
  type SearchResponse,
} from './mail.js';
import { dateTimeOf, folderLabel, plural } from './format.js';
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

const COLUMNS: Column<Hit>[] = [
  { header: 'Date (UTC)', cell: (m) => <span className="nowrap">{dateTimeOf(m.date)}</span> },
  {
    header: 'Expéditeur',
    className: 'keep-words address',
    cell: (m) => <Address value={m.sender} />,
  },
  {
    header: 'Objet',
    className: 'subject',
    cell: (m) => {
      const subject = m.subject === '' ? '(sans objet)' : m.subject;
      return (
        <a href={mailHref(m)} title={subject}>
          {subject}
        </a>
      );
    },
  },
  {
    header: 'Boîte',
    className: 'keep-words address',
    cell: (m) => <Address value={m.mailboxId} />,
  },
  { header: 'Dossier', className: 'nowrap', cell: (m) => folderLabel(m.folder) },
];

const RESTORE_HINT_ID = 'restore-not-configured';

/**
 * Résultats de recherche : métadonnées seulement, chaque ligne mène à la fiche du mail. Avec
 * `restoreConfigured`, chaque ligne propose « Restaurer » (désactivé si la restauration est indisponible).
 */
export function SearchView({
  state,
  restoreConfigured,
  onPage,
}: {
  state: SearchState;
  restoreConfigured?: boolean;
  onPage?: (offset: number) => void;
}) {
  if (state === 'loading') return <p role="status">Recherche en cours…</p>;
  if (state === 'error') return <Alert tone="error">Recherche indisponible</Alert>;
  if (state.items.length === 0) return <EmptyState>Aucun résultat.</EmptyState>;
  const columns: Column<Hit>[] =
    restoreConfigured === undefined
      ? COLUMNS
      : [
          ...COLUMNS,
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
      <p role="status">
        {plural(state.total, 'résultat')}, {state.offset + 1} à {state.offset + state.items.length}
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
export function SearchPage() {
  const [query, setQuery] = useState<SearchQuery | null>(null);
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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQuery(searchQueryFromForm(new FormData(e.currentTarget)));
  }

  return (
    <main tabIndex={-1}>
      <h1>Rechercher et restaurer</h1>
      <form onSubmit={submit} className="filters">
        <FormField label="Recherche" type="search" name="q" maxLength={256} />
        <FormField label="Boîte" type="text" name="mailbox" maxLength={256} />
        <FormField label="Du" type="datetime-local" name="after" />
        <FormField label="Au (exclu)" type="datetime-local" name="before" />
        <Button type="submit">Rechercher</Button>
      </form>
      {state !== null && (
        <SearchView
          state={state}
          restoreConfigured={restoreConfigured}
          onPage={(offset) => {
            if (query) setQuery({ ...query, offset });
          }}
        />
      )}
    </main>
  );
}
