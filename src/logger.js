import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = process.env.OPENCLAW_LOG_DIR || '/home/brans/.openclaw/logs';

try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

export function createLogger(component) {
  const logFile = join(LOG_DIR, `${component}.log`);

  const write = (level, msg) => {
    const line = `[${new Date().toISOString()}] [${level}] [${component}] ${msg}`;
    console.log(line);
    try { appendFileSync(logFile, line + '\n'); } catch {}
  };

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    debug: (msg) => write('DEBUG', msg)
  };
}
