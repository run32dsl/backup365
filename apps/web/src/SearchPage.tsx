import { useEffect, useState, type FormEvent } from 'react';
import { pageOffsets } from './audit.js';
import {
  SEARCH_PAGE_SIZE,
  mailHref,
  searchMails,
  searchQueryFromForm,
  type SearchQuery,
  type SearchResponse,
} from './mail.js';
import { Alert, Button, DataTable, EmptyState, FormField, type Column } from './ui/index.js';

/** État de la recherche. */
export type SearchState = SearchResponse | 'loading' | 'error';

type Hit = SearchResponse['items'][number];

const COLUMNS: Column<Hit>[] = [
  { header: 'Date (UTC)', cell: (m) => m.date },
  { header: 'Expéditeur', cell: (m) => m.sender },
  {
    header: 'Objet',
    cell: (m) => <a href={mailHref(m)}>{m.subject === '' ? '(sans objet)' : m.subject}</a>,
  },
  { header: 'Boîte', cell: (m) => m.mailboxId },
  { header: 'Dossier', cell: (m) => m.folder },
];

/** Résultats de recherche : métadonnées seulement, chaque ligne mène à la fiche du mail. */
export function SearchView({ state }: { state: SearchState }) {
  if (state === 'loading') return <p role="status">Recherche en cours…</p>;
  if (state === 'error') return <Alert tone="error">Recherche indisponible</Alert>;
  if (state.items.length === 0) return <EmptyState>Aucun résultat.</EmptyState>;
  return (
    <>
      <p role="status">
        {state.total} résultat(s), {state.offset + 1} à {state.offset + state.items.length}
      </p>
      <DataTable
        caption="Résultats de la recherche"
        hideCaption
        columns={COLUMNS}
        rows={state.items}
        rowKey={(m) => `${m.mailboxId}/${m.messageId}`}
      />
    </>
  );
}

/** Écran de recherche : champ libre, boîte, plage de dates, résultats paginés. */
export function SearchPage() {
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [state, setState] = useState<SearchState | null>(null);
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

  const pages = pageOffsets(
    query?.offset ?? 0,
    query?.limit ?? SEARCH_PAGE_SIZE,
    typeof state === 'object' && state !== null ? state.total : 0,
  );
  return (
    <main tabIndex={-1}>
      <h1>Rechercher et restaurer</h1>
      <form onSubmit={submit} className="form-row">
        <FormField label="Recherche" type="search" name="q" maxLength={256} />
        <FormField label="Boîte" type="text" name="mailbox" maxLength={256} />
        <FormField label="Du" type="datetime-local" name="after" />
        <FormField label="Au (exclu)" type="datetime-local" name="before" />
        <Button type="submit">Rechercher</Button>
      </form>
      {state !== null && <SearchView state={state} />}
      <div className="button-row">
        <Button
          variant="secondary"
          disabled={pages.previous === null}
          onClick={() => {
            if (query && pages.previous !== null) setQuery({ ...query, offset: pages.previous });
          }}
        >
          Précédent
        </Button>
        <Button
          variant="secondary"
          disabled={pages.next === null}
          onClick={() => {
            if (query && pages.next !== null) setQuery({ ...query, offset: pages.next });
          }}
        >
          Suivant
        </Button>
      </div>
    </main>
  );
}
