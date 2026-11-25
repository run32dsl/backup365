import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_POLL_FAILURES, startPolling } from './restore/useJobPolling.js';

interface Job {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  error: 'restore_error' | 'restore_unreachable' | 'restore_lost' | null;
  durationMs: number | null;
}

const running: Job = { id: 'a', status: 'running', error: null, durationMs: null };
const done: Job = { id: 'a', status: 'succeeded', error: null, durationMs: 1200 };

/** Laisse les promesses en attente se résoudre après un tic d'horloge. */
const tick = async (ms = 1000) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('startPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the last job every second and hands over the finished one', async () => {
    const fetchLast = vi.fn<() => Promise<Job | null>>().mockResolvedValue(running);
    const onJob = vi.fn();
    startPolling(running, fetchLast, onJob);
    await tick();
    expect(fetchLast).toHaveBeenCalledTimes(1);
    expect(onJob).not.toHaveBeenCalled();
    fetchLast.mockResolvedValue(done);
    await tick();
    expect(onJob).toHaveBeenCalledWith(done);
  });

  it('gives the job up as lost when the server no longer knows it', async () => {
    const onJob = vi.fn();
    startPolling(running, () => Promise.resolve(null), onJob);
    await tick();
    expect(onJob).toHaveBeenCalledWith({
      ...running,
      status: 'failed',
      error: 'restore_lost',
      durationMs: null,
    });
  });

  it('gives the job up as lost for another job id', async () => {
    const onJob = vi.fn();
    startPolling(running, () => Promise.resolve({ ...done, id: 'b' }), onJob);
    await tick();
    expect(onJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', error: 'restore_lost' }));
  });

  it(`waits for ${MAX_POLL_FAILURES} failures in a row before giving up`, async () => {
    const onJob = vi.fn();
    startPolling(running, () => Promise.reject(new Error('HTTP 500')), onJob);
    for (let i = 1; i < MAX_POLL_FAILURES; i++) await tick();
    expect(onJob).not.toHaveBeenCalled();
    await tick();
    expect(onJob).toHaveBeenCalledWith(expect.objectContaining({ error: 'restore_lost' }));
  });

  it('counts only failures in a row', async () => {
    const fetchLast = vi.fn<() => Promise<Job | null>>();
    const onJob = vi.fn();
    startPolling(running, fetchLast, onJob);
    for (let i = 0; i < MAX_POLL_FAILURES - 1; i++) {
      fetchLast.mockRejectedValueOnce(new Error('HTTP 500'));
      await tick();
    }
    fetchLast.mockResolvedValueOnce(running);
    await tick();
    for (let i = 0; i < MAX_POLL_FAILURES - 1; i++) {
      fetchLast.mockRejectedValueOnce(new Error('HTTP 500'));
      await tick();
    }
    expect(onJob).not.toHaveBeenCalled();
  });

  it('stops reading once stopped', async () => {
    const fetchLast = vi.fn<() => Promise<Job | null>>().mockResolvedValue(running);
    const stop = startPolling(running, fetchLast, vi.fn());
    stop();
    await tick(5000);
    expect(fetchLast).not.toHaveBeenCalled();
  });
});
