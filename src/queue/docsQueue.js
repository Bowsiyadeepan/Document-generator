import { Queue } from 'bullmq';
import { createRedisConnection } from './redisConnection.js';

const QUEUE_NAME = 'docs-generation';

export const docsQueue = new Queue(QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

docsQueue.on('error', (err) => {
  console.error('[queue] Queue error:', err.message);
});

/**
 * Enqueues a docs generation job.
 *
 * @param {'docs-pr'|'docs-push'} type
 * @param {object} data - Job payload
 * @returns {Promise<Job>}
 */
export async function enqueueDocsJob(type, data) {
  const job = await docsQueue.add(type, { type, ...data }, {
    jobId: `${type}-${data.owner}-${data.repoName}-${Date.now()}`,
  });
  console.log(`[queue] Enqueued job ${job.id} (${type})`);
  return job;
}
