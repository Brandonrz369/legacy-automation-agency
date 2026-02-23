import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('queue');

export class TaskQueue {
  constructor() {
    this.queue = [];
    this.processing = new Map();
    this.done = [];
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_TASKS || '3');
  }

  enqueue(task) {
    this.queue.push(task);
    logger.info(`Enqueued task ${task.id} (queue depth: ${this.queue.length})`);
  }

  pending() { return this.queue.length; }
  completed() { return this.done.length; }
  active() { return this.processing.size; }

  async startProcessing(gemini, openclaw) {
    logger.info('Task processing loop started');

    setInterval(async () => {
      // Don't exceed concurrency limit
      if (this.processing.size >= this.maxConcurrent) return;
      if (this.queue.length === 0) return;

      const task = this.queue.shift();
      this.processing.set(task.id, task);

      logger.info(`Processing task ${task.id} (${task.description.slice(0, 60)}...)`);

      try {
        await this.processTask(task, gemini, openclaw);
      } catch (err) {
        logger.error(`Task ${task.id} failed: ${err.message}`);
        await this.handleFailure(task, err, gemini, openclaw);
      }
    }, 5000); // Check queue every 5 seconds
  }

  async processTask(task, gemini, openclaw) {
    // Phase 1: Gemini orchestrator classifies and plans
    logger.info(`[${task.id}] Phase 1: Gemini classification`);
    task.status = 'classifying';
    this.saveTask(task);

    const plan = await gemini.planExecution(task);
    task.plan = plan;
    task.status = 'planned';
    this.saveTask(task);

    // Phase 2: Execute based on mode
    logger.info(`[${task.id}] Phase 2: Execution (mode: ${task.envelope.mode})`);
    task.status = 'executing';
    task.envelope.hops++;
    this.saveTask(task);

    let result;

    switch (task.envelope.mode) {
      case 'EXECUTE':
        result = await openclaw.executeTask(task, plan);
        break;
      case 'SUPERVISE':
        result = await openclaw.superviseTask(task, plan);
        break;
      case 'ARCHITECT':
        result = await gemini.architectTask(task);
        break;
      default:
        result = await openclaw.executeTask(task, plan);
    }

    // Phase 3: Flash-Lite verification
    logger.info(`[${task.id}] Phase 3: Verification`);
    task.status = 'verifying';
    this.saveTask(task);

    const verification = await gemini.verifyResult(task, result);

    if (verification.status === 'PASS') {
      task.status = 'completed';
      task.result = result;
      task.verification = verification;
      task.envelope.consecutive_successes++;
      task.envelope.consecutive_failures = 0;

      // De-escalate after 2 consecutive successes
      if (task.envelope.consecutive_successes >= 2 && task.envelope.escalated) {
        task.envelope.mode = 'EXECUTE';
        task.envelope.escalated = false;
        logger.info(`[${task.id}] De-escalated to EXECUTE mode`);
      }

      this.saveTask(task);
      this.processing.delete(task.id);
      this.done.push(task);
      logger.info(`[${task.id}] COMPLETED successfully`);

    } else if (verification.status === 'RETRY') {
      task.envelope.consecutive_failures++;
      task.envelope.consecutive_successes = 0;

      // Anti-loop: check TTL
      if (task.envelope.hops >= task.envelope.ttl_max) {
        logger.warn(`[${task.id}] TTL exceeded (${task.envelope.hops}/${task.envelope.ttl_max}). Dead-lettering.`);
        task.status = 'dead-lettered';
        this.saveTask(task);
        this.deadLetter(task);
        this.processing.delete(task.id);
        return;
      }

      // Hysteresis: escalate after 3 failures
      if (task.envelope.consecutive_failures >= 3 && !task.envelope.escalated) {
        task.envelope.mode = 'ARCHITECT';
        task.envelope.escalated = true;
        logger.info(`[${task.id}] Escalated to ARCHITECT mode after 3 failures`);
      }

      // Re-enqueue
      task.status = 'retrying';
      this.saveTask(task);
      this.processing.delete(task.id);
      this.queue.push(task);
      logger.info(`[${task.id}] Retrying (hop ${task.envelope.hops}/${task.envelope.ttl_max})`);

    } else {
      // ESCALATE - needs human intervention
      task.status = 'needs-human';
      task.verification = verification;
      this.saveTask(task);
      this.processing.delete(task.id);
      logger.warn(`[${task.id}] Needs human intervention`);
    }
  }

  async handleFailure(task, error, gemini, openclaw) {
    task.envelope.consecutive_failures++;
    task.last_error = error.message;

    if (task.envelope.hops >= task.envelope.ttl_max) {
      task.status = 'dead-lettered';
      this.saveTask(task);
      this.deadLetter(task);
      this.processing.delete(task.id);
      return;
    }

    if (task.envelope.consecutive_failures >= 3) {
      task.envelope.mode = 'ARCHITECT';
      task.envelope.escalated = true;
    }

    task.status = 'retrying';
    this.saveTask(task);
    this.processing.delete(task.id);
    this.queue.push(task);
  }

  saveTask(task) {
    const dir = process.env.TASK_DIR || '/home/brans/legacy-automation-agency/tasks';
    try {
      writeFileSync(join(dir, `${task.id}.json`), JSON.stringify(task, null, 2));
    } catch (err) {
      logger.error(`Failed to save task ${task.id}: ${err.message}`);
    }
  }

  deadLetter(task) {
    const dlDir = '/home/brans/.openclaw/dead-letter';
    try {
      writeFileSync(join(dlDir, `${task.id}.json`), JSON.stringify(task, null, 2));
      logger.warn(`Task ${task.id} moved to dead-letter queue`);
    } catch (err) {
      logger.error(`Failed to dead-letter task ${task.id}: ${err.message}`);
    }
  }
}
