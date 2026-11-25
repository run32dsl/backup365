import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultList } from './ResultList.js';

const NBSP = '\u00a0';

describe('ResultList', () => {
  it('keeps a dated value unbreakable between date, time and UTC', () => {
    const html = renderToStaticMarkup(
      <ResultList rows={[['Date de la sauvegarde (UTC)', 'Mail · 22/11/2026 21:01 UTC']]} />,
    );
    expect(html).toContain(`22/11/2026${NBSP}21:01${NBSP}UTC`);
    expect(html).not.toMatch(/\d{4} \d{2}:\d{2}/);
    expect(html).not.toMatch(/\d{2}:\d{2} UTC/);
  });
});
