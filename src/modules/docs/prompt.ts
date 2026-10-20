import { truncateForPrompt, cleanAnswer } from '@ai/parse';
import type { DocCandidate, DocsFacts } from './facts';
import { outline, sectionBody, splitLines } from './sections';
import type { Section } from './sections';

// The Documentador gets the facts and the parts of ONE document, and answers with section edits.

export const WHOLE_DOC_MAX_LINES = 250;
const MAX_SECTIONS = 6;
export const MAX_SECTION_LINES = 80;
const MAX_FACTS_CHARS = 7000;

export interface SectionEdit {
  heading: string;
  body: string;
  // a section that does not exist yet (appended at the end)
  isNew: boolean;
}

function describeFacts(facts: DocsFacts): string {
  const changes = facts.changes
    .map((change) => {
      const label = change.status === 'renamed' ? `renomeado de ${change.from} para ${change.path}` : `${change.status === 'added' ? 'novo' : change.status === 'deleted' ? 'removido' : 'alterado'}: ${change.path}`;
      const exports = change.exports.length > 0 ? `\n  exports: ${change.exports.join(', ')}` : '';
      const diff = change.diff ? `\n${change.diff.split('\n').map((line) => `    ${line}`).join('\n')}` : '';
      return `- ${label}${exports}${diff}`;
    })
    .join('\n');
  const scripts = Object.entries(facts.scripts).map(([name, command]) => `- npm run ${name}: ${command}`).join('\n');
  return truncateForPrompt(
    `Hoje: ${new Date().toISOString().slice(0, 10)} (use esta data se acrescentar uma linha de histórico)

Commits desde a última atualização da documentação:\n${facts.commits.map((commit) => `- ${commit}`).join('\n') || '- (só mudanças não commitadas)'}\n\nArquivos de código que mudaram:\n${changes}\n\nScripts do package.json hoje:\n${scripts || '- (nenhum)'}`,
    MAX_FACTS_CHARS
  );
}

function score(section: Section, lines: string[], terms: string[]): number {
  const text = lines.slice(section.start, section.end).join('\n');
  return terms.filter((term) => text.includes(term)).length;
}

function describeDoc(doc: DocCandidate, terms: string[]): string {
  const { lines } = splitLines(doc.content);
  if (lines.length <= WHOLE_DOC_MAX_LINES) return `Documento inteiro:\n${doc.content}`;

  const picked = [...doc.mentioned].sort((a, b) => score(b, lines, terms) - score(a, lines, terms)).slice(0, MAX_SECTIONS);
  const bodies = picked
    .map((section) => {
      const body = sectionBody(lines, section).split('\n').slice(0, MAX_SECTION_LINES).join('\n');
      return `${section.heading}\n${body}`;
    })
    .join('\n\n---\n\n');
  return `Índice do documento (títulos):\n${outline(doc.sections)}\n\nSeções que citam o que mudou:\n${bodies}`;
}

// What this document must change, as a checklist (computed by code, see facts.ts).
function describeTasks(doc: DocCandidate): string[] {
  const tasks: string[] = [];
  doc.stale.forEach((name) => tasks.push(`"${name}" não existe mais no código: troque pelo nome atual (veja o diff) ou tire do texto`));
  doc.undocumented.forEach((name) => tasks.push(`"${name}" é novo no código e o documento não fala dele: inclua onde fizer sentido (ex.: na tabela de scripts, na seção de uso)`));
  return tasks;
}

// Local models copy the shape of an example far better than they follow a description of it.
const FORMAT_EXAMPLE = `Exemplo de resposta (outro projeto, só para mostrar o formato):
SEÇÃO: ## Uso
\`\`\`md
\`\`\`ts
import { parseDate } from './src/date';

parseDate('2026-01-01');
\`\`\`
\`\`\``;

export function buildDocsPrompt(doc: DocCandidate, facts: DocsFacts): string {
  const tasks = describeTasks(doc);
  const todo =
    tasks.length > 0
      ? `O QUE MUDAR NESTE DOCUMENTO (conferido pelo código; faça todos):\n${tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}`
      : 'Confira se algo no documento ficou desatualizado pelas mudanças acima. Se nada ficou, responda só: NADA';

  return `${describeFacts(facts)}

=== ${doc.file} ===
${describeDoc(doc, facts.terms)}

${todo}

REGRAS:
- Mude só as seções necessárias; mantenha o resto do texto exatamente igual (idioma, tom, tabelas, links)
- Não invente nada que não esteja nos fatos acima (nomes, parâmetros e scripts vêm do diff e da lista de scripts)
- Histórico, diário ou decisões antigas (datas passadas) NÃO se reescreve: no máximo acrescente uma linha nova
- Para cada seção que mudar, escreva "SEÇÃO:" + o título EXATAMENTE como está no documento, e depois o conteúdo novo e COMPLETO dessa seção (sem o título) dentro de um bloco \`\`\`md
- Seção que ainda não existe: "SEÇÃO NOVA: ## Título" (vai para o fim do documento)

${FORMAT_EXAMPLE}

Resposta:`;
}

// "SEÇÃO: ## X", "**SEÇÃO:** ## X", "SEÇÃO NOVA: ## X"
const SECTION_LINE = /^\s*\**SE[ÇC][ÃA]O(\s+NOVA)?\s*:?\s*\**\s*:?\s*(#{1,6}\s+.+?)\s*$/i;
const FENCE_LINE = /^\s*(```|~~~)(\S*)\s*$/;

// "SEÇÃO: ## X" followed by a fenced block. Read line by line because a README section usually has
// code blocks inside (```ts … ```): an inner fence with a language opens, a bare fence closes the
// innermost open one, and the outer block ends at its own bare fence.
export function parseDocsAnswer(response: string): SectionEdit[] | 'nothing' {
  const lines = cleanAnswer(response).split('\n');
  const edits: SectionEdit[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(SECTION_LINE);
    if (!header) continue;
    let open = index + 1;
    while (open < lines.length && !lines[open].trim()) open += 1;
    const outer = lines[open]?.match(FENCE_LINE);
    if (!outer) {
      // no fence at all: the section runs until the next "SEÇÃO:" line
      let stop = open;
      while (stop < lines.length && !SECTION_LINE.test(lines[stop])) stop += 1;
      const plain = lines.slice(open, stop).join('\n').replace(/\s+$/, '');
      if (plain) edits.push({ isNew: Boolean(header[1]), heading: header[2].trim(), body: plain });
      index = stop - 1;
      continue;
    }

    // An outer ```ts (not ```md) is the section's own code block: it stays in the body.
    const keepOuter = Boolean(outer[2]) && !/^(md|markdown)$/i.test(outer[2]);
    const body: string[] = keepOuter ? [lines[open]] : [];
    let depth = 0;
    let closed = false;
    for (let cursor = open + 1; cursor < lines.length; cursor += 1) {
      const fence = lines[cursor].match(FENCE_LINE);
      if (fence && fence[2]) depth += 1;
      else if (fence && depth > 0) depth -= 1;
      else if (fence && fence[1] === outer[1]) {
        if (keepOuter) body.push(lines[cursor]);
        closed = true;
        index = cursor;
        break;
      }
      body.push(lines[cursor]);
    }
    if (closed) edits.push({ isNew: Boolean(header[1]), heading: header[2].trim(), body: body.join('\n').replace(/\s+$/, '') });
  }

  if (edits.length === 0 && /^\s*NADA\b/i.test(lines.join('\n'))) return 'nothing';
  return edits;
}
