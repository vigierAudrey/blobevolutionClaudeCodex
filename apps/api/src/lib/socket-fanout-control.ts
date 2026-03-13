import { secureLogger } from '../utils/secure-logger';

const WS_PUSH_PER_MESSAGE_MAX = Number(process.env.WS_PUSH_PER_MESSAGE_MAX || '50');
const WS_PUSH_QUEUE_MAX_PENDING = Number(process.env.WS_PUSH_QUEUE_MAX_PENDING || '500');
const WS_PUSH_QUEUE_CONCURRENCY = Number(process.env.WS_PUSH_QUEUE_CONCURRENCY || '20');
const WS_CONVERSATION_TOUCH_MIN_INTERVAL_MS = Number(process.env.WS_CONVERSATION_TOUCH_MIN_INTERVAL_MS || '1000');

type FanoutMetrics = {
  pushAttempted: number;
  pushQueued: number;
  pushSent: number;
  pushDropped: number;
  pushDroppedByBudget: number;
  queueDepth: number;
  queueMaxDepth: number;
  conversationTouchExecuted: number;
  conversationTouchSkipped: number;
};

const metrics: FanoutMetrics = {
  pushAttempted: 0,
  pushQueued: 0,
  pushSent: 0,
  pushDropped: 0,
  pushDroppedByBudget: 0,
  queueDepth: 0,
  queueMaxDepth: 0,
  conversationTouchExecuted: 0,
  conversationTouchSkipped: 0
};

const touchState = new Map<string, number>();

type PushTask = () => Promise<void>;
const queue: PushTask[] = [];
let running = 0;

function updateQueueMetrics(): void {
  metrics.queueDepth = queue.length;
  if (queue.length > metrics.queueMaxDepth) {
    metrics.queueMaxDepth = queue.length;
  }
}

function pumpQueue(): void {
  while (running < WS_PUSH_QUEUE_CONCURRENCY && queue.length > 0) {
    const task = queue.shift()!;
    running += 1;
    updateQueueMetrics();

    task()
      .then(() => {
        metrics.pushSent += 1;
      })
      .catch((error) => {
        metrics.pushDropped += 1;
        secureLogger.error('WS_PUSH_QUEUE_TASK_FAILED', {
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        running -= 1;
        pumpQueue();
      });
  }
}

export function selectPushTargets(userIds: string[]): { targets: string[]; droppedByBudget: number } {
  const targets = userIds.slice(0, WS_PUSH_PER_MESSAGE_MAX);
  const droppedByBudget = Math.max(0, userIds.length - targets.length);
  metrics.pushAttempted += userIds.length;
  metrics.pushDroppedByBudget += droppedByBudget;
  return { targets, droppedByBudget };
}

export function enqueuePushTask(task: PushTask): boolean {
  const pending = queue.length + running;
  if (pending >= WS_PUSH_QUEUE_MAX_PENDING) {
    metrics.pushDropped += 1;
    return false;
  }

  queue.push(task);
  metrics.pushQueued += 1;
  updateQueueMetrics();
  pumpQueue();
  return true;
}

export async function touchConversationCoalesced(
  conversationId: string,
  touchFn: () => Promise<void>
): Promise<boolean> {
  const now = Date.now();
  const lastTouchAt = touchState.get(conversationId) || 0;
  if (now - lastTouchAt < WS_CONVERSATION_TOUCH_MIN_INTERVAL_MS) {
    metrics.conversationTouchSkipped += 1;
    return false;
  }

  touchState.set(conversationId, now);
  await touchFn();
  metrics.conversationTouchExecuted += 1;
  return true;
}

export function getFanoutMetrics(): FanoutMetrics & {
  pushPerMessageMax: number;
  queueMaxPending: number;
  queueConcurrency: number;
  conversationTouchMinIntervalMs: number;
} {
  return {
    ...metrics,
    pushPerMessageMax: WS_PUSH_PER_MESSAGE_MAX,
    queueMaxPending: WS_PUSH_QUEUE_MAX_PENDING,
    queueConcurrency: WS_PUSH_QUEUE_CONCURRENCY,
    conversationTouchMinIntervalMs: WS_CONVERSATION_TOUCH_MIN_INTERVAL_MS
  };
}

export function resetFanoutMetricsForTests(): void {
  touchState.clear();
  queue.length = 0;
  running = 0;

  metrics.pushAttempted = 0;
  metrics.pushQueued = 0;
  metrics.pushSent = 0;
  metrics.pushDropped = 0;
  metrics.pushDroppedByBudget = 0;
  metrics.queueDepth = 0;
  metrics.queueMaxDepth = 0;
  metrics.conversationTouchExecuted = 0;
  metrics.conversationTouchSkipped = 0;
}
