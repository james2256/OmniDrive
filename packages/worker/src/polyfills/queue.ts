import type {
  ExecutionContext,
  MessageBatch,
  MessageSendRequest,
  QueueMetrics,
} from '@cloudflare/workers-types';
import type { Env, SyncJobMessage } from '../types/env';

/**
 * In-process Queue polyfill for Node self-host mode.
 *
 * Cloudflare Workers Queue API is not available in Node. This polyfill:
 * - Implements send() + sendBatch() + metrics() (the 3 methods on Queue<Body>)
 * - Invokes worker.queue() synchronously with a mock MessageBatch
 * - Preserves the queue consumer pattern — sync actually runs
 *
 * In Cloudflare mode, the real Queue binding is used (this file is not loaded).
 *
 * Re-entrant recursion limitation: the queue consumer re-enqueues via
 * env.SYNC_QUEUE.send() at index.ts:184 when a sync pauses. In Cloudflare
 * mode, each invocation is a fresh isolate. In this polyfill's Node mode,
 * re-enqueue happens on the same stack. For a 200K-file drive needing ~5
 * resumptions, that's 5 stack frames — safe. A pathological drive that never
 * completes could blow the stack.
 */
export class QueueWrapper {
  constructor(
    private worker: {
      queue?: (
        batch: MessageBatch<SyncJobMessage>,
        env: Env,
        ctx: ExecutionContext,
      ) => Promise<void>;
    },
    private getEnv: () => Env,
    private getCtx: () => ExecutionContext,
  ) {}

  async send(body: SyncJobMessage): Promise<void> {
    await this.sendBatch([{ body }]);
  }

  async sendBatch(messages: MessageSendRequest<SyncJobMessage>[]): Promise<void> {
    if (!this.worker.queue) {
      console.warn('SYNC_QUEUE.send called but worker.queue is not defined — sync will not run');
      return;
    }
    // Mock MessageBatch — only the fields the queue consumer reads.
    const batch = {
      messages: messages.map((m) => ({
        body: m.body,
        ack: () => {},
        retry: () => {},
      })),
    } as unknown as MessageBatch<SyncJobMessage>;
    await this.worker.queue(batch, this.getEnv(), this.getCtx());
  }

  async metrics(): Promise<QueueMetrics> {
    return { backlogCount: 0, backlogBytes: 0 };
  }
}
