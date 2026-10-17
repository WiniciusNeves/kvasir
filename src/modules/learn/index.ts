import os from 'os';
import path from 'path';
import { readFeedback } from '@utils/feedback';
import { promptAI } from '@ai/client';
import { cleanAnswer } from '@ai/parse';
import { writeFile, readFile } from '@utils/fs';
import { confirm } from '@utils/prompt';

const MAX_FEEDBACK_ENTRIES = 150;
const DEFAULT_PROFILE = '# profile.md\n\n## Preferências aprendidas\n\n## Stack pessoal\n';

function getProfilePath(): string {
  return path.join(os.homedir(), '.kvasir', 'profile.md');
}

// Only the most recent entries: the full log grows forever and the old ones are already in the profile.
function recentEntries(feedback: string): string[] {
  return feedback.split('\n').filter((line) => line.startsWith('- [')).slice(-MAX_FEEDBACK_ENTRIES);
}

function buildLearnPrompt(currentProfile: string, entries: string[]): string {
  return `Você mantém o perfil de preferências de um desenvolvedor, usado para personalizar sugestões de IA (commits, correções, revisões).

Perfil atual (profile.md):
${currentProfile}

Feedback recente (APPROVED = ele aceitou a sugestão da IA, REJECTED = recusou ou editou):
${entries.join('\n')}

Atualize o perfil com as preferências que o feedback mostra de forma consistente (ex.: estilo de mensagem de commit que ele aprova, tipos de correção que recusa).

Regras:
- Mantenha a estrutura e as seções existentes; só acrescente ou refine itens
- Não invente preferências que o feedback não sustenta
- Escreva em português, itens curtos

Responda com o conteúdo COMPLETO do novo profile.md, começando por "# profile.md", sem comentários antes ou depois.`;
}

// Claude often wraps the file in a code fence or adds a sentence before it: keep only the markdown.
function extractProfile(answer: string): string {
  const clean = cleanAnswer(answer);
  const fence = clean.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  const body = fence ? fence[1] : clean;
  const headingIndex = body.search(/^# /m);
  return `${(headingIndex >= 0 ? body.slice(headingIndex) : body).trim()}\n`;
}

export async function runLearn(): Promise<void> {
  const feedback = await Promise.all([readFeedback('commits'), readFeedback('fixes'), readFeedback('patterns')]);
  const entries = feedback.flatMap(recentEntries);

  if (entries.length === 0) {
    console.log('Nenhum feedback registrado ainda. Use commit, fix e review e rode "kvasir learn" depois.');
    return;
  }

  const currentProfile = (await readFile(getProfilePath())) ?? DEFAULT_PROFILE;
  console.log(`\nAnalisando ${entries.length} registro(s) de feedback com o Claude...`);

  const updatedProfile = extractProfile(await promptAI(buildLearnPrompt(currentProfile, entries)));

  console.log('\nPerfil proposto:\n');
  console.log(updatedProfile);

  const approved = await confirm(`Salvar em ${getProfilePath()}?`);
  if (!approved) {
    console.log('Perfil não alterado.');
    return;
  }

  await writeFile(getProfilePath(), updatedProfile);
  console.log('✅ profile.md atualizado.');
}
