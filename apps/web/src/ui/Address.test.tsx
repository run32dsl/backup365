import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Address } from './Address.js';

describe('Address', () => {
  it('puts the domain in its own span so a cut falls after the @', () => {
    expect(renderToString(<Address value="a@exemple.test" />)).toContain(
      '<span class="addr-local">a@</span><span class="addr-domain">exemple.test</span>',
    );
  });

  it('flags addresses longer than 40 characters so they may wrap after the @', () => {
    const at40 = `${'a'.repeat(27)}@exemple.test`;
    expect(at40).toHaveLength(40);
    expect(renderToString(<Address value={at40} />)).not.toContain('addr-long');
    expect(renderToString(<Address value={`b${at40}`} />)).toContain('addr-long');
  });

  it('renders a value without @ as plain text', () => {
    expect(renderToString(<Address value="msg-1" />)).toBe('msg-1');
  });
});
