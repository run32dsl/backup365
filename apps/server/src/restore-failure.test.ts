import {
  GraphAccessRefusedError,
  GraphUnavailableError,
  OwnerBusyError,
  StorageUnavailableError,
} from '@wisecom/atlas-sdk';
import { describe, expect, it } from 'vitest';
import { restoreFailureOf } from './restore-failure.js';

describe('restoreFailureOf: SDK 7.2.0 errors (issue #567)', () => {
  it('reads the code of the real SDK errors', () => {
    expect(restoreFailureOf(new OwnerBusyError({ workload: 'outlook', owner_id: 'owner-1' }))).toBe(
      'restore_busy',
    );
    expect(
      restoreFailureOf(
        new GraphAccessRefusedError('refused', { owner_id: 'owner-1' }, 'access_refused'),
      ),
    ).toBe('restore_denied');
    expect(restoreFailureOf(new StorageUnavailableError('no answer', 3))).toBe('restore_storage');
    expect(
      restoreFailureOf(new GraphUnavailableError('no answer', { retries: 3, elapsed_ms: 1 })),
    ).toBe('restore_unreachable');
  });

  it('reports a refusal before any write as a failed restoration, not an unreachable source', () => {
    expect(restoreFailureOf({ code: 'ATLAS_WRITE_REFUSED' })).toBe('restore_error');
    expect(restoreFailureOf({ code: 'ATLAS_FORMAT_UNSUPPORTED' })).toBe('restore_error');
  });

  it('falls back to unreachable for any other error', () => {
    expect(restoreFailureOf(new Error('timeout'))).toBe('restore_unreachable');
    expect(restoreFailureOf(null)).toBe('restore_unreachable');
    expect(restoreFailureOf({ code: 'ATLAS_OWNER_BUSY_X' })).toBe('restore_unreachable');
  });
});
