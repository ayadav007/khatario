import { spawn } from 'child_process';
import { ApiError } from './ApiError.js';

const MAX_CAPTURE_LENGTH = 2 * 1024 * 1024;

const appendChunk = (current, chunk) => {
  const next = current + chunk.toString();
  return next.length > MAX_CAPTURE_LENGTH ? next.slice(-MAX_CAPTURE_LENGTH) : next;
};

const parseJsonOutput = (stdout, stderr, command) => {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new ApiError(502, 'OCR subprocess returned no JSON output', {
      command,
      stderr: stderr.trim().slice(-4000)
    });
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new ApiError(502, 'OCR subprocess returned invalid JSON', {
      command,
      parseError: error.message,
      stdout: trimmed.slice(-4000),
      stderr: stderr.trim().slice(-4000)
    });
  }
};

export const runJsonSubprocess = ({
  command,
  args = [],
  timeoutMs,
  cwd = process.cwd()
}) => new Promise((resolve, reject) => {
  let stdout = '';
  let stderr = '';
  let settled = false;

  const child = spawn(command, args, {
    cwd,
    windowsHide: true
  });

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGKILL');
    reject(new ApiError(504, 'OCR subprocess timed out', {
      command,
      timeoutMs
    }));
  }, timeoutMs);

  child.stdout.on('data', (chunk) => {
    stdout = appendChunk(stdout, chunk);
  });

  child.stderr.on('data', (chunk) => {
    stderr = appendChunk(stderr, chunk);
  });

  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(new ApiError(502, 'Unable to start OCR subprocess', {
      command,
      error: error.message
    }));
  });

  child.on('close', (exitCode) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);

    try {
      const payload = parseJsonOutput(stdout, stderr, command);

      if (exitCode !== 0 || payload.success === false) {
        reject(new ApiError(502, payload.error?.message || 'OCR subprocess failed', {
          command,
          exitCode,
          stderr: stderr.trim().slice(-4000),
          error: payload.error
        }));
        return;
      }

      resolve(payload.data);
    } catch (error) {
      reject(error);
    }
  });
});
