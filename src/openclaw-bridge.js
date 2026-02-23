import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('openclaw-bridge');

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/home/brans/.openclaw/state';
const SESSION_FILE = join(STATE_DIR, 'session.json');

export class OpenClawBridge {
  constructor() {
    logger.info('OpenClaw Bridge initialized');
  }

  /**
   * Get current session state from the watchdog's state file.
   */
  getSessionState() {
    try {
      return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    } catch {
      return { status: 'unknown' };
    }
  }

  /**
   * Update session state.
   */
  updateState(updates) {
    const state = this.getSessionState();
    Object.assign(state, updates);
    writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
  }

  /**
   * Spawn a new Claude Code session for a task.
   * Uses tmux to manage multiple sessions.
   */
  async spawnClaudeSession({ taskId, mode, prompt }) {
    const sessionName = `task-${taskId.slice(-8)}`;

    logger.info(`Spawning Claude Code session: ${sessionName} (mode: ${mode})`);

    try {
      // Create tmux window for this task
      execSync(`tmux new-window -t openclaw -n ${sessionName} 2>/dev/null || true`);

      // Start Claude Code in the window
      execSync(`tmux send-keys -t openclaw:${sessionName} "claude" Enter`);

      // Wait for Claude to initialize
      await new Promise(r => setTimeout(r, 5000));

      // Send the task prompt
      const fullPrompt = this.buildPrompt(taskId, mode, prompt);
      execSync(`tmux send-keys -t openclaw:${sessionName} "${fullPrompt.replace(/"/g, '\\"')}" Enter`);

      const session = {
        id: sessionName,
        task_id: taskId,
        mode,
        started_at: new Date().toISOString(),
        status: 'running'
      };

      logger.info(`Session spawned: ${sessionName}`);
      return session;

    } catch (err) {
      logger.error(`Failed to spawn session ${sessionName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Build the appropriate prompt based on mode (EXECUTE/ARCHITECT/SUPERVISE).
   */
  buildPrompt(taskId, mode, taskDescription) {
    const base = `Task ID: ${taskId}\nMode: ${mode}\n\n`;

    switch (mode) {
      case 'EXECUTE':
        return base + `EXECUTE MODE: You have full tool access. Complete this task:\n${taskDescription}\n\nReport results as JSON when complete.`;

      case 'ARCHITECT':
        return base + `ARCHITECT MODE: Read-only analysis. Do NOT execute anything.\nAnalyze this task and produce a detailed execution plan:\n${taskDescription}\n\nReturn a step-by-step plan as JSON.`;

      case 'SUPERVISE':
        return base + `SUPERVISE MODE: Computer Use enabled. Use screenshots, mouse, and keyboard.\nComplete this GUI task:\n${taskDescription}\n\nTake screenshots before and after each action. Report results as JSON.`;

      default:
        return base + taskDescription;
    }
  }

  /**
   * Take a screenshot of the current desktop.
   */
  async takeScreenshot() {
    const screenshotDir = '/home/brans/legacy-automation-agency/screenshots';
    const filename = `screenshot-${Date.now()}.png`;
    const filepath = join(screenshotDir, filename);

    try {
      // Try different screenshot tools
      try {
        execSync(`gnome-screenshot -f ${filepath} 2>/dev/null`);
      } catch {
        try {
          execSync(`scrot ${filepath} 2>/dev/null`);
        } catch {
          try {
            execSync(`import -window root ${filepath} 2>/dev/null`);
          } catch {
            // Use xdotool + xwd as last resort
            execSync(`xdpyinfo >/dev/null 2>&1 && xwd -root -out /tmp/screen.xwd && convert /tmp/screen.xwd ${filepath} 2>/dev/null`);
          }
        }
      }

      logger.info(`Screenshot captured: ${filepath}`);
      return filepath;
    } catch (err) {
      logger.warn(`Screenshot failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Execute a task using shell commands (EXECUTE mode).
   */
  async executeTask(task, plan) {
    const results = [];

    for (const step of (plan.steps || [])) {
      if (step.mode === 'SUPERVISE') {
        // Skip GUI steps in EXECUTE mode — they need SUPERVISE
        results.push({
          step: step.step_number,
          status: 'skipped',
          reason: 'GUI step requires SUPERVISE mode'
        });
        continue;
      }

      logger.info(`[${task.id}] Executing step ${step.step_number}: ${step.action}`);

      try {
        // For EXECUTE mode, we dispatch to a Claude Code session
        const session = await this.spawnClaudeSession({
          taskId: task.id,
          mode: 'EXECUTE',
          prompt: `Step ${step.step_number}: ${step.action}\n\nVerification: ${step.verification}`
        });

        results.push({
          step: step.step_number,
          status: 'dispatched',
          session: session.id
        });
      } catch (err) {
        results.push({
          step: step.step_number,
          status: 'failed',
          error: err.message
        });
      }
    }

    return { task_id: task.id, mode: 'EXECUTE', results };
  }

  /**
   * Execute a GUI task using Computer Use (SUPERVISE mode).
   */
  async superviseTask(task, plan) {
    const results = [];

    for (const step of (plan.steps || [])) {
      logger.info(`[${task.id}] SUPERVISE step ${step.step_number}: ${step.action}`);

      // Take screenshot before action
      const beforeScreenshot = await this.takeScreenshot();

      try {
        const session = await this.spawnClaudeSession({
          taskId: task.id,
          mode: 'SUPERVISE',
          prompt: `Step ${step.step_number}: ${step.action}\n\nExpected UI state: ${step.verification}`
        });

        // Take screenshot after action
        const afterScreenshot = await this.takeScreenshot();

        results.push({
          step: step.step_number,
          status: 'dispatched',
          session: session.id,
          screenshots: { before: beforeScreenshot, after: afterScreenshot }
        });
      } catch (err) {
        results.push({
          step: step.step_number,
          status: 'failed',
          error: err.message
        });
      }
    }

    return { task_id: task.id, mode: 'SUPERVISE', results };
  }
}
