import path from 'path';

/**
 * Parses a unified diff patch string into structured hunks with line numbers.
 *
 * @param {string} patch - Raw unified diff patch (e.g. from GitHub API)
 * @param {string} filename - Filename for context in output
 * @returns {Array<{header, oldStart, newStart, filename, lines}>}
 */
export function parsePatch(patch, filename) {
  if (!patch) return [];

  const hunks = [];
  const lines = patch.split('\n');

  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      currentHunk = {
        header: line,
        oldStart: oldLine,
        newStart: newLine,
        filename,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

// Patterns that signal breaking changes in diffs
const BREAKING_PATTERNS = [
  { pattern: /^-\s*export\s+(function|class|const|let|var|default)\s+(\w+)/, reason: 'Removed export: $2' },
  { pattern: /^-\s*module\.exports\s*=/, reason: 'Removed module.exports assignment' },
  { pattern: /^-\s*(app|router)\.(get|post|put|patch|delete|all)\s*\(/, reason: 'Removed HTTP route' },
  { pattern: /^-\s*(export\s+)?(async\s+)?function\s+\w+\s*\(/, reason: 'Changed function signature' },
  { pattern: /^-\s*process\.env\.([A-Z_]+)/, reason: 'Removed env var reference: $1' },
  { pattern: /^-\s*export\s+(interface|type)\s+(\w+)/, reason: 'Removed exported type/interface: $2' },
  { pattern: /^-\s*(public|protected)\s+(async\s+)?\w+\s*\(/, reason: 'Removed public class method' },
];

/**
 * Analyzes a list of changed files for breaking change signals.
 *
 * @param {Array<{filename, patch, status}>} files
 * @returns {{breaking: boolean, reasons: string[]}}
 */
export function detectBreakingChanges(files) {
  const reasons = [];

  for (const file of files) {
    if (!file.patch) continue;

    if (file.status === 'removed' && isSourceFile(file.filename)) {
      reasons.push(`Source file deleted: ${file.filename}`);
      continue;
    }

    const lines = file.patch.split('\n');
    for (const line of lines) {
      for (const { pattern, reason } of BREAKING_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          const resolvedReason = reason.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] || '');
          reasons.push(`${file.filename}: ${resolvedReason}`);
          break;
        }
      }
    }
  }

  const unique = [...new Set(reasons)];
  return { breaking: unique.length > 0, reasons: unique };
}

const ALWAYS_IGNORE = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.gitattributes', '.editorconfig',
  'Dockerfile', 'docker-compose.yml',
];

const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.mp3', '.wav', '.mov',
];

// Test file patterns always excluded regardless of config
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\/test\//,
  /\/tests\//,
];

/**
 * Filters a file list to only source files relevant for documentation.
 *
 * @param {Array<{filename, status, patch}>} files
 * @param {{source_extensions: string[], ignore_paths: string[]}} config
 * @returns {Array<{filename, status, patch}>}
 */
export function filterSourceFiles(files, config) {
  const { source_extensions = ['.js', '.ts', '.py', '.go', '.java'], ignore_paths = [] } = config;

  return files.filter((file) => {
    const filename = file.filename;
    const ext = path.extname(filename).toLowerCase();

    if (file.status === 'removed') return false;
    if (BINARY_EXTENSIONS.includes(ext)) return false;
    if (ALWAYS_IGNORE.includes(path.basename(filename))) return false;
    if (TEST_FILE_PATTERNS.some((p) => p.test(filename))) return false;

    for (const ignorePath of ignore_paths) {
      const normalized = ignorePath.replace(/\*/g, '');
      if (filename.startsWith(normalized) || filename.includes(normalized)) return false;
    }

    return source_extensions.includes(ext);
  });
}

const LANGUAGE_MAP = {
  '.js':   'JavaScript',
  '.mjs':  'JavaScript',
  '.cjs':  'JavaScript',
  '.jsx':  'JavaScript',
  '.ts':   'TypeScript',
  '.tsx':  'TypeScript',
  '.py':   'Python',
  '.go':   'Go',
  '.java': 'Java',
  '.kt':   'Kotlin',
  '.rb':   'Ruby',
  '.rs':   'Rust',
};

/**
 * Detects the programming language from a filename.
 *
 * @param {string} filename
 * @returns {string} Language name or 'Unknown'
 */
export function detectLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  return LANGUAGE_MAP[ext] || 'Unknown';
}

const ROUTE_PATTERN = /^([+-])\s*(app|router|server)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/;

/**
 * Scans diffs for added or removed HTTP route definitions.
 *
 * @param {Array<{filename, patch}>} files
 * @returns {{added: string[], removed: string[]}}
 */
export function getChangedRoutes(files) {
  const added = [];
  const removed = [];

  for (const file of files) {
    if (!file.patch) continue;

    for (const line of file.patch.split('\n')) {
      const match = line.match(ROUTE_PATTERN);
      if (match) {
        const [, sign, , method, routePath] = match;
        const route = `${method.toUpperCase()} ${routePath}`;
        if (sign === '+') added.push(route);
        else if (sign === '-') removed.push(route);
      }
    }
  }

  return {
    added: [...new Set(added)],
    removed: [...new Set(removed)],
  };
}

function isSourceFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return Object.keys(LANGUAGE_MAP).includes(ext);
}
