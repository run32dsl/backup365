import { describe, expect, it } from 'vitest';
import { healthResponse } from './health.js';

describe('healthResponse', () => {
  it('reports ok with the given version', () => {
    expect(healthResponse('1.2.3')).toEqual({ status: 'ok', version: '1.2.3' });
  });
});
