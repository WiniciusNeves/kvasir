import { askLocal } from '@ai/router';
import { answerLines } from '@ai/parse';
import { allEntries, SUBMENUS } from './catalog';

// "kvasir quero salvar minha chave do groq" → "kvasir keys set groq". The model only picks from the
// catalog; the answer is checked against the real commands before anything is offered.

function buildIntentPrompt(sentence: string): string {
  const commands = allEntries()
    .map((entry) => `kvasir ${entry.usage ?? entry.argv.join(' ')}  →  ${entry.label}`)
    .join('\n');

  return `Comandos do Kvasir (CLI para desenvolvedores):
${commands}

O usuário digitou: "kvasir ${sentence}"

Qual comando da lista faz o que ele quer? Regras:
- Responda com UMA linha só: o comando exatamente como na lista, começando com "kvasir".
- Troque <...> pelo valor que o usuário disse (ex.: "kvasir keys set groq"). [...] é opcional: só preencha se ele disse.
- Se o usuário não disse o valor de um <...>, deixe sem ele (ex.: "kvasir keys set").
- Se nenhum comando serve, responda: nenhum

Exemplos:
"faz o commit aí" → kvasir commit
"deu erro no build, arruma" → kvasir fix
"documenta a lib axios" → kvasir doc axios
"manda pro repo" → kvasir push
"quero colocar minha chave do gemini" → kvasir keys set gemini
"pede uma pizza" → nenhum

Resposta:`;
}

// Accepts only commands that exist: top-level name, and for groups a real subcommand.
export function parseIntent(answer: string, knownCommands: string[]): string[] | null {
  const line = answerLines(answer)
    .map((item) => item.replace(/^[`"'\s]+|[`"'\s.]+$/g, ''))
    .find((item) => /^kvasir\s+\S/i.test(item) || /^nenhum\b/i.test(item));
  if (!line || /^nenhum\b/i.test(line)) return null;

  const argv = line.split(/\s+/).slice(1).filter((token) => !/^[<[].*[>\]]$/.test(token));
  const [command, subcommand] = argv;
  if (!command || !knownCommands.includes(command)) return null;

  const group = SUBMENUS[command];
  if (group) {
    const subcommands = group.entries.filter((entry) => entry.argv[0] === command).map((entry) => entry.argv[1]);
    if (!subcommand || !subcommands.includes(subcommand)) return [command];
  }
  return argv;
}

export async function interpretIntent(sentence: string, knownCommands: string[]): Promise<string[] | null> {
  try {
    const answer = await askLocal('intent', buildIntentPrompt(sentence), { maxTokens: 40, temperature: 0 });
    return parseIntent(answer, knownCommands);
  } catch {
    return null;
  }
}
