import { writeFile, readFile } from '@utils/fs';
import { z } from 'zod';
import type { KvasirContext, ActiveTaskInfo } from '@ktypes/context';

const CONTEXT_FILE = 'kvasir.context.md';

function buildContextMarkdown(ctx: KvasirContext): string {
  const lines: string[] = [];

  lines.push('# kvasir.context.md', '');
  lines.push('## Project');
  lines.push(`- name: ${ctx.project.name}`);
  lines.push(`- type: ${ctx.project.type}`);
  lines.push(`- stack: ${ctx.project.stack.join(', ')}`);
  lines.push(`- persona: ${ctx.project.persona}`, '');

  lines.push('## Developer');
  lines.push(`- profile: ${ctx.developer.profile}`, '');

  lines.push('## Branch rules');
  lines.push(`- pattern: ${ctx.branchRules.pattern}`);
  lines.push(`- prefix: ${ctx.branchRules.prefix}`);
  lines.push(`- language: ${ctx.branchRules.language}`, '');

  lines.push('## Commit rules');
  lines.push(`- convention: ${ctx.commitRules.convention}`);
  lines.push(`- language: ${ctx.commitRules.language}`);
  lines.push(`- format: ${ctx.commitRules.format}`, '');

  lines.push('## Active modules');
  lines.push(`- ${ctx.activeModules.join(', ')}`, '');

  if (ctx.activeTask) {
    lines.push('## Active task');
    lines.push(`- id: ${ctx.activeTask.id}`);
    lines.push(`- title: ${ctx.activeTask.title}`);
    lines.push(`- linked branch: ${ctx.activeTask.linkedBranch}`, '');
  }

  return lines.join('\n');
}

function extractSection(markdown: string, section: string): string {
  const sectionRegex = new RegExp(`## ${section}([\\s\\S]*?)(?=\\n## |$)`);
  const sectionMatch = sectionRegex.exec(markdown);
  return sectionMatch ? sectionMatch[1] : '';
}

function extractField(markdown: string, section: string, field: string): string {
  const sectionContent = extractSection(markdown, section);
  if (!sectionContent) return '';

  const fieldRegex = new RegExp(`-\\s*${field}:\\s*(.*)`);
  const fieldMatch = fieldRegex.exec(sectionContent);
  return fieldMatch ? fieldMatch[1].trim() : '';
}

function extractListItem(markdown: string, section: string): string {
  const sectionContent = extractSection(markdown, section);
  const itemMatch = /-\s*(.*)/.exec(sectionContent);
  return itemMatch ? itemMatch[1].trim() : '';
}

// The file is markdown and people edit it by hand: a field lost in an edit used to become "" silently
// (a branch without prefix, a commit in the wrong language). Now it fails with what is missing.
const required = (field: string) => z.string().min(1, { error: field });
const ContextSchema = z.object({
  project: z.object({ name: required('Project → name'), type: z.string(), stack: z.array(z.string()), persona: required('Project → persona') }),
  developer: z.object({ profile: z.string() }),
  branchRules: z.object({
    pattern: required('Branch rules → pattern'),
    prefix: required('Branch rules → prefix'),
    language: required('Branch rules → language'),
  }),
  commitRules: z.object({
    convention: required('Commit rules → convention'),
    language: required('Commit rules → language'),
    format: required('Commit rules → format'),
  }),
  activeModules: z.array(z.string()),
  activeTask: z.object({ id: z.string(), title: z.string(), linkedBranch: z.string() }).nullable(),
  summary: z.string(),
});

function validateContext(context: KvasirContext): KvasirContext {
  const result = ContextSchema.safeParse(context);
  if (result.success) return context;
  const missing = [...new Set(result.error.issues.map((issue) => issue.message))].join(', ');
  throw new Error(`${CONTEXT_FILE} incompleto ou editado fora do formato: falta ${missing}. Rode "kvasir init" de novo (a task ativa é mantida).`);
}

function parseContextMarkdown(markdown: string): KvasirContext {
  const activeTaskId = extractField(markdown, 'Active task', 'id');

  return {
    project: {
      name: extractField(markdown, 'Project', 'name'),
      type: extractField(markdown, 'Project', 'type'),
      stack: extractField(markdown, 'Project', 'stack')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      persona: extractField(markdown, 'Project', 'persona'),
    },
    developer: {
      profile: extractField(markdown, 'Developer', 'profile'),
    },
    branchRules: {
      pattern: extractField(markdown, 'Branch rules', 'pattern'),
      prefix: extractField(markdown, 'Branch rules', 'prefix'),
      language: extractField(markdown, 'Branch rules', 'language'),
    },
    commitRules: {
      convention: extractField(markdown, 'Commit rules', 'convention'),
      language: extractField(markdown, 'Commit rules', 'language'),
      format: extractField(markdown, 'Commit rules', 'format'),
    },
    activeModules: extractListItem(markdown, 'Active modules')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    activeTask: activeTaskId
      ? {
          id: activeTaskId,
          title: extractField(markdown, 'Active task', 'title'),
          linkedBranch: extractField(markdown, 'Active task', 'linked branch'),
        }
      : null,
    summary: `${extractField(markdown, 'Project', 'name')} (${extractField(markdown, 'Project', 'type')}) — stack: ${extractField(markdown, 'Project', 'stack')}`,
  };
}

export async function writeContext(ctx: KvasirContext): Promise<void> {
  const markdown = buildContextMarkdown(ctx);
  await writeFile(CONTEXT_FILE, markdown);
}

export async function readContext(): Promise<KvasirContext> {
  const markdown = await readFile(CONTEXT_FILE);
  if (!markdown) {
    throw new Error(`${CONTEXT_FILE} não encontrado. Rode "kvasir init" primeiro.`);
  }
  return validateContext(parseContextMarkdown(markdown));
}

function buildActiveTaskSection(task: ActiveTaskInfo): string {
  return ['## Active task', `- id: ${task.id}`, `- title: ${task.title}`, `- linked branch: ${task.linkedBranch}`, ''].join('\n');
}

// Rewrites only the "## Active task" section, so anything else edited by hand in the file survives.
export async function setActiveTask(task: ActiveTaskInfo): Promise<void> {
  const markdown = await readFile(CONTEXT_FILE);
  if (!markdown) {
    throw new Error(`${CONTEXT_FILE} não encontrado. Rode "kvasir init" primeiro.`);
  }

  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const normalized = markdown.replace(/\r\n/g, '\n');
  const section = buildActiveTaskSection(task);
  const sectionRegex = /## Active task\n[\s\S]*?(?=\n## |$)/;

  const updated = sectionRegex.test(normalized)
    ? normalized.replace(sectionRegex, section.trimEnd())
    : `${normalized.trimEnd()}\n\n${section}`;

  await writeFile(CONTEXT_FILE, `${updated.trimEnd()}\n`.replace(/\n/g, eol));
}
