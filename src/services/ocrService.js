/**
 * @fileoverview OCR Service for PDF text extraction using RolmOCR.
 * @module services/ocrService
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OCR_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ocr', 'rolm_ocr_service.py');
const OCR_VENV_PYTHON = path.join(__dirname, '..', '..', 'scripts', 'ocr', 'venv', 'Scripts', 'python.exe');
const OCR_VENV_PYTHON_UNIX = path.join(__dirname, '..', '..', 'scripts', 'ocr', 'venv', 'bin', 'python');

// Python executable - try venv first, then system python
const PYTHON_EXECUTABLES = [OCR_VENV_PYTHON, OCR_VENV_PYTHON_UNIX, 'python3', 'python', 'py'];

/**
 * Find available Python executable.
 * @returns {Promise<string|null>} Python executable path or null
 */
async function findPython() {
  for (const exe of PYTHON_EXECUTABLES) {
    try {
      // For venv paths, check if file exists first
      if (exe.includes('venv')) {
        if (!fs.existsSync(exe)) {
          continue;
        }
      }

      const result = await runCommand(exe, ['--version']);
      if (result.success) {
        logger.info('OCR', `Found Python: ${exe}`);
        return exe;
      }
    } catch {
      // Try next executable
    }
  }
  return null;
}

/**
 * Run a command and return the result.
 * @param {string} command - Command to run
 * @param {string[]} args - Arguments
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
function runCommand(command, args) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });

    proc.on('error', () => {
      resolve({
        success: false,
        stdout: '',
        stderr: 'Command not found'
      });
    });
  });
}

/**
 * Check if the OCR service is available.
 * @returns {Promise<{available: boolean, error?: string}>}
 */
export async function checkOCRAvailability() {
  // Check if script exists
  if (!fs.existsSync(OCR_SCRIPT_PATH)) {
    return {
      available: false,
      error: `OCR script not found at ${OCR_SCRIPT_PATH}`
    };
  }

  // Find Python
  const python = await findPython();
  if (!python) {
    return {
      available: false,
      error: 'Python not found. Please install Python 3.8+'
    };
  }

  // Check if dependencies are installed
  try {
    const result = await runCommand(python, [OCR_SCRIPT_PATH, '--check']);
    const response = JSON.parse(result.stdout);
    return response;
  } catch (err) {
    return {
      available: false,
      error: `OCR check failed: ${err.message}`
    };
  }
}

/**
 * Extract text from a PDF using RolmOCR.
 * @param {string} pdfBase64 - Base64 encoded PDF content
 * @returns {Promise<{success: boolean, text?: string, pages?: Array, error?: string}>}
 */
export async function extractTextFromPDF(pdfBase64) {
  logger.info('OCR', 'Starting PDF text extraction with RolmOCR');
  logger.info('OCR', `PDF base64 length: ${pdfBase64?.length || 0}`);

  // Find Python
  const python = await findPython();
  if (!python) {
    throw new Error('Python not found. Please install Python 3.8+');
  }
  logger.info('OCR', `Python found, script path: ${OCR_SCRIPT_PATH}`);

  // Check script exists
  if (!fs.existsSync(OCR_SCRIPT_PATH)) {
    throw new Error(`OCR script not found at ${OCR_SCRIPT_PATH}`);
  }
  logger.info('OCR', 'Script exists, creating temp file');

  // Write PDF to temp file (command line args have length limits)
  const os = await import('os');
  const tempDir = os.tmpdir();
  const tempPdfPath = path.join(tempDir, `ocr_${Date.now()}.pdf`);
  logger.info('OCR', `Temp path: ${tempPdfPath}`);

  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    fs.writeFileSync(tempPdfPath, pdfBuffer);
    logger.info('OCR', `Wrote PDF to temp file: ${tempPdfPath} (${pdfBuffer.length} bytes)`);
  } catch (err) {
    throw new Error(`Failed to write temp PDF: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    const args = [OCR_SCRIPT_PATH, tempPdfPath, '--output', 'json'];
    logger.info('OCR', `Spawning: ${python} ${args.join(' ')}`);

    const proc = spawn(python, args, {
      shell: false,  // Don't use shell to avoid ENAMETOOLONG issues
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Cleanup temp file when done
    const cleanup = () => {
      try {
        if (fs.existsSync(tempPdfPath)) {
          fs.unlinkSync(tempPdfPath);
        }
      } catch (_e) {
        // Ignore cleanup errors
      }
    };

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log progress messages
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('[OCR]')) {
          logger.info('OCR', line.replace('[OCR] ', ''));
        }
      }
    });

    proc.on('close', (code) => {
      cleanup();

      if (code !== 0) {
        logger.error('OCR', `Process exited with code ${code}: ${stderr}`);
        reject(new Error(`OCR failed: ${stderr || 'Unknown error'}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          logger.info('OCR', `Extracted text from ${result.total_pages} pages`);
          resolve({
            success: true,
            text: result.full_text,
            pages: result.pages,
            totalPages: result.total_pages
          });
        } else {
          reject(new Error(result.error || 'OCR extraction failed'));
        }
      } catch (err) {
        logger.error('OCR', `Failed to parse OCR output: ${err.message}`);
        reject(new Error(`Failed to parse OCR output: ${stdout.substring(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      cleanup();
      logger.error('OCR', `Process error: ${err.message}`);
      reject(new Error(`Failed to start OCR process: ${err.message}`));
    });
  });
}

/**
 * Check OCR status and return detailed info.
 * @returns {Promise<object>}
 */
export async function getOCRStatus() {
  const status = {
    scriptExists: fs.existsSync(OCR_SCRIPT_PATH),
    pythonAvailable: false,
    pythonVersion: null,
    dependenciesInstalled: false,
    gpuAvailable: false,
    error: null
  };

  // Check Python
  const python = await findPython();
  if (python) {
    status.pythonAvailable = true;
    const versionResult = await runCommand(python, ['--version']);
    status.pythonVersion = versionResult.stdout;

    // Check dependencies
    if (status.scriptExists) {
      try {
        const checkResult = await runCommand(python, [OCR_SCRIPT_PATH, '--check']);
        const response = JSON.parse(checkResult.stdout);
        status.dependenciesInstalled = response.available;
        if (response.error) {
          status.error = response.error;
        }
      } catch (err) {
        status.error = err.message;
      }
    }

    // Check GPU (torch.cuda.is_available)
    try {
      const gpuCheck = await runCommand(python, ['-c', 'import torch; print(torch.cuda.is_available())']);
      status.gpuAvailable = gpuCheck.stdout.trim().toLowerCase() === 'true';
    } catch {
      // torch not installed or other error
    }
  }

  return status;
}

export default {
  checkOCRAvailability,
  extractTextFromPDF,
  getOCRStatus
};
