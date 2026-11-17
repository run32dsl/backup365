import { pageOffsets } from '../audit.js';
import { Button } from './Button.js';

/** « Précédent » / « Suivant » ; absents quand le total tient sur une page. */
export function Pager({
  offset,
  limit,
  total,
  onPage,
}: {
  offset: number;
  limit: number;
  total: number;
  onPage?: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const pages = pageOffsets(offset, limit, total);
  return (
    <div className="button-row">
      <Button
        variant="secondary"
        disabled={pages.previous === null}
        onClick={() => {
          if (pages.previous !== null) onPage?.(pages.previous);
        }}
      >
        Précédent
      </Button>
      <Button
        variant="secondary"
        disabled={pages.next === null}
        onClick={() => {
          if (pages.next !== null) onPage?.(pages.next);
        }}
      >
        Suivant
      </Button>
    </div>
  );
}
