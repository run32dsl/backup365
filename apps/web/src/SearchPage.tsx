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

/** État de la recherche. */
export type SearchState = SearchResponse | 'loading' | 'error';

/** Résultats de recherche : métadonnées seulement, chaque ligne mène à la fiche du mail. */
export function SearchView({ state }: { state: SearchState }) {
  if (state === 'loading') return <p role="status">Recherche en cours…</p>;
  if (state === 'error') return <p role="alert">Recherche indisponible</p>;
  if (state.items.length === 0) return <p role="status">Aucun résultat.</p>;
  return (
    <>
      <p role="status">
        {state.total} résultat(s), {state.offset + 1} à {state.offset + state.items.length}
      </p>
      <table>
        <thead>
          <tr>
            <th>Date (UTC)</th>
            <th>Expéditeur</th>
            <th>Objet</th>
            <th>Boîte</th>
            <th>Dossier</th>
          </tr>
        </thead>
        <tbody>
          {state.items.map((m) => (
            <tr key={`${m.mailboxId}/${m.messageId}`}>
              <td>{m.date}</td>
              <td>{m.sender}</td>
              <td>
                <a href={mailHref(m)}>{m.subject === '' ? '(sans objet)' : m.subject}</a>
              </td>
              <td>{m.mailboxId}</td>
              <td>{m.folder}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    <main>
      <h1>Recherche de mails</h1>
      <form onSubmit={submit}>
        <label>
          Recherche <input type="search" name="q" maxLength={256} />
        </label>{' '}
        <label>
          Boîte <input type="text" name="mailbox" maxLength={256} />
        </label>{' '}
        <label>
          Du <input type="datetime-local" name="after" />
        </label>{' '}
        <label>
          Au (exclu) <input type="datetime-local" name="before" />
        </label>{' '}
        <button type="submit">Chercher</button>
      </form>
      {state !== null && <SearchView state={state} />}
      <p>
        <button
          type="button"
          disabled={pages.previous === null}
          onClick={() => {
            if (query && pages.previous !== null) setQuery({ ...query, offset: pages.previous });
          }}
        >
          Précédent
        </button>{' '}
        <button
          type="button"
          disabled={pages.next === null}
          onClick={() => {
            if (query && pages.next !== null) setQuery({ ...query, offset: pages.next });
          }}
        >
          Suivant
        </button>
      </p>
    </main>
  );
}
