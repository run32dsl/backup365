import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Address } from './Address.js';

describe('Address', () => {
  it('puts the domain in its own span so a cut falls after the @', () => {
    expect(renderToString(<Address value="a@exemple.test" />)).toContain(
      '<span class="addr addr-short"><span class="addr-local">a@</span><span class="addr-domain">exemple.test</span>',
    );
  });

  it('marks only addresses of 40 characters or fewer as short (one line on desktop)', () => {
    const forty = 'a'.repeat(28) + '@exemple.fr0';
    expect(forty).toHaveLength(40);
    expect(renderToString(<Address value={forty} />)).toContain('class="addr addr-short"');
    expect(renderToString(<Address value={forty + 'x'} />)).toContain('<span class="addr">');
  });

  it('renders a value without @ as plain text', () => {
    expect(renderToString(<Address value="msg-1" />)).toBe('msg-1');
  });
});
