import { describe, expect, it } from 'vitest';
import { retentionExcess } from './retention.js';

const now = new Date('2026-11-26T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('retentionExcess', () => {
  it('compte les instantanés plus vieux que la durée, leur volume et les éléments concernés', () => {
    const byItem = new Map([
      [
        'a',
        [
          { createdAt: daysAgo(1), sizeBytes: 10 },
          { createdAt: daysAgo(100), sizeBytes: 200 },
          { createdAt: daysAgo(400), sizeBytes: 3000 },
        ],
      ],
      ['b', [{ createdAt: daysAgo(91), sizeBytes: 5 }]],
      ['c', [{ createdAt: daysAgo(2), sizeBytes: 7 }]],
    ]);
    expect(retentionExcess(90, byItem, now)).toEqual({
      cutoff: daysAgo(90),
      snapshots: 3,
      items: 2,
      bytes: 3205,
      oldestAt: daysAgo(400),
    });
  });

  it("garde un instantané créé pile à l'échéance", () => {
    const byItem = new Map([['a', [{ createdAt: daysAgo(90), sizeBytes: 1 }]]]);
    expect(retentionExcess(90, byItem, now)).toMatchObject({ snapshots: 0, bytes: 0 });
  });

  it('rend zéro sans instantané et compte 0 octet pour une taille absente', () => {
    expect(retentionExcess(30, new Map(), now)).toEqual({
      cutoff: daysAgo(30),
      snapshots: 0,
      items: 0,
      bytes: 0,
      oldestAt: null,
    });
    const byItem = new Map([['a', [{ createdAt: daysAgo(40) }]]]);
    expect(retentionExcess(30, byItem, now)).toMatchObject({ snapshots: 1, bytes: 0 });
  });
});
