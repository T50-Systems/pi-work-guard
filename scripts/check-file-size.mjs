#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const maxLines = Number(process.env.PI_WORK_GUARD_MAX_LINES ?? '500');
const warnLines = Number(process.env.PI_WORK_GUARD_WARN_LINES ?? '450');

async function gitFiles() {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd, maxBuffer: 2_000_000 });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return walk(cwd);
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(path.relative(cwd, full).replaceAll('\\\\', '/'));
  }
  return out;
}

const files = (await gitFiles()).filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file));
const issues = [];
for (const file of files) {
  if (file.includes('node_modules/')) continue;
  const content = await readFile(path.join(cwd, file), 'utf8');
  const lines = content ? content.split(/\r?\n/).length : 0;
  if (lines > maxLines) issues.push({ severity: 'ERROR', file, lines });
  else if (lines > warnLines) issues.push({ severity: 'WARN', file, lines });
}

if (issues.length === 0) {
  console.log(`pi-work-guard: file-size ok (${files.length} files, max ${maxLines})`);
  process.exit(0);
}

for (const issue of issues) {
  console.log(`${issue.severity} ${issue.file}: ${issue.lines} lines`);
}

if (issues.some((issue) => issue.severity === 'ERROR')) process.exit(1);
