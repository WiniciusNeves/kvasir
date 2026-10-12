import { writeFile, readFile } from '@utils/fs';
import type { KvasirContext } from '@ktypes/context';

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
    throw new Error(`${CONTEXT_FILE} not found. Run "kvasir init" first.`);
  }
  return parseContextMarkdown(markdown);
}

export async function loadContext(): Promise<KvasirContext> {
  return readContext();
}
