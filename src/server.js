import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

function require_fs_fallback() { return { readdirSync }; }
import dotenv from 'dotenv';
import { TaskQueue } from './queue.js';
import { GeminiOrchestrator } from './gemini-orchestrator.js';
import { OpenClawBridge } from './openclaw-bridge.js';
import { createLogger } from './logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const app = express();
const logger = createLogger('server');
const upload = multer({ dest: join(ROOT, 'uploads/') });

// Ensure directories exist
['uploads', 'tasks', 'results', 'screenshots'].forEach(dir => {
  const path = join(ROOT, dir);
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(join(ROOT, 'public')));

// --- Core Components ---
const gemini = new GeminiOrchestrator();
const taskQueue = new TaskQueue();
const openclaw = new OpenClawBridge();

// --- Health & Status ---
app.get('/api/health', (req, res) => {
  const state = openclaw.getSessionState();
  res.json({
    status: 'running',
    version: '1.0.0',
    service: 'Legacy Interface Automation Agency',
    watchdog: state.status,
    tasks_pending: taskQueue.pending(),
    tasks_completed: taskQueue.completed(),
    uptime: process.uptime()
  });
});

// --- Task Submission (Client-facing) ---
app.post('/api/tasks', upload.array('documents', 10), async (req, res) => {
  try {
    const { description, software_name, task_type } = req.body;
    const files = req.files || [];

    const taskId = `LEGACY-${Date.now()}-${uuidv4().slice(0, 8)}`;

    const task = {
      id: taskId,
      description,
      software_name: software_name || 'unknown',
      task_type: task_type || 'data-entry',
      documents: files.map(f => ({
        original: f.originalname,
        path: f.path,
        mimetype: f.mimetype,
        size: f.size
      })),
      status: 'received',
      created_at: new Date().toISOString(),
      envelope: {
        ttl_max: 10,
        hops: 0,
        mode: 'EXECUTE',
        state_hashes: [],
        consecutive_failures: 0,
        consecutive_successes: 0,
        escalated: false,
        session_ids: [],
        mcp_cache_key: `${taskId}-cache`
      }
    };

    // Save task to disk
    writeFileSync(
      join(ROOT, 'tasks', `${taskId}.json`),
      JSON.stringify(task, null, 2)
    );

    // Enqueue for Gemini orchestration
    taskQueue.enqueue(task);

    logger.info(`Task submitted: ${taskId} - ${description}`);

    res.status(201).json({
      task_id: taskId,
      status: 'received',
      message: 'Task received. Gemini orchestrator will classify and dispatch.',
      estimated_time: '5-30 minutes depending on complexity'
    });
  } catch (err) {
    logger.error(`Task submission error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- Task Status ---
app.get('/api/tasks/:taskId', (req, res) => {
  const taskPath = join(ROOT, 'tasks', `${req.params.taskId}.json`);
  if (!existsSync(taskPath)) {
    return res.status(404).json({ error: 'Task not found' });
  }
  const task = JSON.parse(readFileSync(taskPath, 'utf8'));
  res.json(task);
});

// --- List all tasks ---
app.get('/api/tasks', (req, res) => {
  const tasksDir = join(ROOT, 'tasks');
  if (!existsSync(tasksDir)) return res.json([]);

  const { readdirSync } = require_fs_fallback();
  const files = readdirSync(tasksDir).filter(f => f.endsWith('.json'));
  const tasks = files.map(f =>
    JSON.parse(readFileSync(join(tasksDir, f), 'utf8'))
  );
  res.json(tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// --- Webhook for OpenClaw/Telegram/Discord ---
app.post('/api/webhook/openclaw', async (req, res) => {
  const { message, channel, user_id } = req.body;

  logger.info(`OpenClaw webhook: [${channel}] ${message}`);

  // Gemini classifies the incoming message
  const classification = await gemini.classifyTask(message);

  if (classification.type === 'simple') {
    // Simple query - Gemini handles directly
    const response = await gemini.handleSimpleQuery(message);
    res.json({ response, handled_by: 'gemini' });
  } else {
    // Complex task - create task and enqueue
    const taskId = `LEGACY-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const task = {
      id: taskId,
      description: message,
      software_name: classification.software || 'unknown',
      task_type: classification.type,
      documents: [],
      status: 'received',
      created_at: new Date().toISOString(),
      source: { channel, user_id },
      envelope: {
        ttl_max: 10,
        hops: 0,
        mode: classification.mode || 'EXECUTE',
        state_hashes: [],
        consecutive_failures: 0,
        consecutive_successes: 0,
        escalated: false,
        session_ids: [],
        mcp_cache_key: `${taskId}-cache`
      }
    };

    writeFileSync(join(ROOT, 'tasks', `${taskId}.json`), JSON.stringify(task, null, 2));
    taskQueue.enqueue(task);

    res.json({
      task_id: taskId,
      status: 'queued',
      classification,
      message: 'Task queued for processing'
    });
  }
});

// --- OpenClaw Bridge: Spawn Claude Code Session ---
app.post('/api/openclaw/spawn', async (req, res) => {
  const { task_id, mode, prompt } = req.body;

  try {
    const session = await openclaw.spawnClaudeSession({
      taskId: task_id,
      mode: mode || 'EXECUTE',
      prompt
    });
    res.json({ session_id: session.id, status: 'spawned' });
  } catch (err) {
    logger.error(`Spawn error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- OpenClaw Bridge: Computer Use (screenshot + action) ---
app.post('/api/openclaw/screenshot', async (req, res) => {
  try {
    const screenshot = await openclaw.takeScreenshot();
    res.json({ path: screenshot, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dashboard ---
app.get('/', (req, res) => {
  res.sendFile(join(ROOT, 'public', 'index.html'));
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Legacy Automation Agency server running on port ${PORT}`);
  logger.info(`Dashboard: http://localhost:${PORT}`);
  logger.info(`API: http://localhost:${PORT}/api/health`);

  // Start the task processing loop
  taskQueue.startProcessing(gemini, openclaw);
});
