import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../src/lib/concurrency';

describe('runWithConcurrency', () => {
  it('runs all tasks and returns results in order', async () => {
    const tasks = [async () => 'a', async () => 'b', async () => 'c'];
    const results = await runWithConcurrency(tasks, 2);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('respects the concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return i;
    });
    const results = await runWithConcurrency(tasks, 3);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it('resolves immediately for an empty task list', async () => {
    const results = await runWithConcurrency([], 3);
    expect(results).toEqual([]);
  });

  it('handles a single task', async () => {
    const results = await runWithConcurrency([async () => 42], 3);
    expect(results).toEqual([42]);
  });

  it('propagates errors (matches Promise.all semantics)', async () => {
    const tasks = [
      async () => 'ok',
      async () => {
        throw new Error('task failed');
      },
      async () => 'never reached',
    ];
    await expect(runWithConcurrency(tasks, 2)).rejects.toThrow('task failed');
  });

  it('preserves result order despite varying completion times', async () => {
    const tasks = [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'slow';
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'fast';
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return 'medium';
      },
    ];
    const results = await runWithConcurrency(tasks, 3);
    expect(results).toEqual(['slow', 'fast', 'medium']);
  });

  it('handles limit of 1 (sequential execution)', async () => {
    const order: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) => async () => {
      order.push(i);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return i;
    });
    const results = await runWithConcurrency(tasks, 1);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});
