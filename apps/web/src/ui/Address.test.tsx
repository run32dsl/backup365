import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Address } from './Address.js';

describe('Address', () => {
  it('puts the domain in its own span so a cut falls after the @', () => {
    expect(renderToString(<Address value="a@exemple.test" />)).toContain(
      '<span class="addr-local">a@</span><span class="addr-domain">exemple.test</span>',
    );
  });

  it('renders a value without @ as plain text', () => {
    expect(renderToString(<Address value="msg-1" />)).toBe('msg-1');
  });
});
