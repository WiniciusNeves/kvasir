import { readContext } from '@modules/init/contextWriter';
import { writeFile } from '@utils/fs';
import type { KvasirContext } from '@ktypes/context';

function buildCopilotInstructions(ctx: KvasirContext): string {
  return [
    `# Copilot Instructions — ${ctx.project.name}`,
    '',
    `Stack: ${ctx.project.stack.join(', ')}`,
    `Persona: ${ctx.project.persona}`,
    '',
    '## Branch naming',
    `- ${ctx.branchRules.prefix} (${ctx.branchRules.language})`,
    '',
    '## Commit message format',
    `- ${ctx.commitRules.format} (${ctx.commitRules.language}, ${ctx.commitRules.convention})`,
    '',
  ].join('\n');
}

export async function writeCopilot(): Promise<void> {
  const ctx = await readContext();
  const content = buildCopilotInstructions(ctx);
  await writeFile('.github/copilot-instructions.md', content);
}
