import 'dotenv/config';
import { Worker } from 'bullmq';
import { createRedisConnection } from './queue/redisConnection.js';
import { runDocsGeneration } from './agent/docsAgent.js';

const QUEUE_NAME = 'docs-generation';
const CONCURRENCY = 2;

console.log('[worker] Starting DocuBot worker...');

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[worker] Processing job ${job.id} (${job.name}) attempt ${job.attemptsMade + 1}`);

    const startTime = Date.now();

    try {
      const result = await runDocsGeneration(job.data, (progress, message) => {
        job.updateProgress(progress);
        console.log(`[worker] Job ${job.id} [${progress}%] ${message}`);
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[worker] Job ${job.id} completed in ${duration}s -- ` +
        `${result.filesGenerated} files generated, PR: ${result.prUrl || 'none'}`
      );

      return result;
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[worker] Job ${job.id} failed after ${duration}s: ${err.message}`);
      throw err;
    }
  },
  {
    connection: createRedisConnection(),
    concurrency: CONCURRENCY,
    limiter: {
      max: 10,
      duration: 60_000,
    },
  }
);

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  if (job?.attemptsMade >= 3) {
    console.error(`[worker] Job ${job.id} exhausted all retries`);
  }
});

worker.on('error', (err) => {
  console.error('[worker] Worker error:', err.message);
});

worker.on('stalled', (jobId) => {
  console.warn(`[worker] Job ${jobId} stalled -- will be retried`);
});

async function shutdown(signal) {
  console.log(`[worker] Received ${signal} -- shutting down gracefully...`);
  await worker.close();
  console.log('[worker] Worker closed. Goodbye.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[worker] Listening on queue "${QUEUE_NAME}" with concurrency ${CONCURRENCY}`);
