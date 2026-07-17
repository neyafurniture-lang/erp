/**
 * Lance l'optimiseur Python si disponible, sinon fallback JS.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { optimizeStudioLayout } from './cutting-optimizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '../../scripts/cut_optimize.py');

function runPython(payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Python optimize timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `python exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function studioOptimize(payload = {}) {
  try {
    const result = await runPython(payload);
    if (result?.boards || result?.sheets) {
      return { ...result, engine: result.engine || 'python' };
    }
  } catch {
    // fallback JS
  }
  return optimizeStudioLayout(payload);
}
