import path from 'path';
import { cleanAnswer, truncateForPrompt } from '@ai/parse';
import { listExports } from '@utils/imports';
import type { TestSetup } from './framework';

const MAX_SOURCE_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 4_000;

export interface TestTarget {
  sourceFile: string;
  testFile: string;
  source: string;
}

// Import specifier from the test file to the source file ("./cart" or "../cart").
export function importPathFor(target: TestTarget): string {
  const relative = path.relative(path.dirname(target.testFile), target.sourceFile).replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

const NAMED_VALUE = /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const NAMED_TYPE = /^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm;
const DEFAULT_EXPORT = /^export\s+default\s+(?:async\s+)?(?:function\*?|class)?\s*([A-Za-z_$][\w$]*)?/m;

// The exact import lines, computed from the source: named vs default is a fact, not something to guess
// (qwen2.5-coder wrote `import slugify from` for a named export).
export function buildImportLines(target: TestTarget): string[] {
  const from = importPathFor(target);
  const values = [...target.source.matchAll(NAMED_VALUE)].map((match) => match[1]);
  const types = [...target.source.matchAll(NAMED_TYPE)].map((match) => match[1]);
  const defaultMatch = target.source.match(DEFAULT_EXPORT);
  const lines: string[] = [];

  if (defaultMatch) {
    const name = defaultMatch[1] ?? path.parse(target.sourceFile).name.replace(/\W/g, '');
    lines.push(values.length > 0 ? `import ${name}, { ${values.join(', ')} } from "${from}";` : `import ${name} from "${from}";`);
  } else if (values.length > 0) {
    lines.push(`import { ${values.join(', ')} } from "${from}";`);
  }
  if (types.length > 0) lines.push(`import type { ${types.join(', ')} } from "${from}";`);
  return lines;
}

function frameworkRules(setup: TestSetup, isComponent: boolean): string {
  const rules =
    setup.framework === 'vitest'
      ? ['- Use vitest: import { describe, it, expect, vi } from "vitest"']
      : ['- Use jest: describe, it, expect e jest.fn() são globais (não importe)'];

  if (isComponent && setup.testingLibrary) {
    rules.push(`- Componentes React: use ${setup.testingLibrary} (render, screen, fireEvent)`);
  } else if (isComponent) {
    rules.push('- Não há Testing Library instalada: teste só as funções exportadas que não renderizam nada');
  }
  return rules.join('\n');
}

export function buildGeneratePrompt(target: TestTarget, setup: TestSetup, projectContext = ''): string {
  const exportsList = listExports(target.source);
  const isComponent = target.sourceFile.endsWith('.tsx');
  const example = setup.example
    ? `Teste existente do projeto (siga o mesmo estilo):\n// ${setup.example.file}\n${setup.example.content}\n`
    : '';

  return `Você escreve testes automatizados em TypeScript.

Arquivo a testar: ${target.sourceFile}
Exports: ${exportsList.join(', ') || '(nenhum encontrado)'}
\`\`\`ts
${truncateForPrompt(target.source, MAX_SOURCE_CHARS)}
\`\`\`

${projectContext ? `${projectContext}\n` : ''}${example}Escreva o arquivo de teste ${target.testFile}.
- Importe o arquivo testado EXATAMENTE assim (já está certo, não troque por import default/nomeado):
${buildImportLines(target).join('\n')}
${frameworkRules(setup, isComponent)}
- Teste os exports reais acima: caso normal, casos de borda (lista vazia, zero, negativo) e erros que o código lança
- Só passe valores que os tipos dos parâmetros aceitam: NUNCA null/undefined/NaN num parâmetro "number[]", "string" etc. (o TypeScript rejeitaria)
- Os valores esperados têm que sair do que o código FAZ (leia a implementação); não invente comportamento
- Dados "válidos" (CPF, e-mail, data, telefone) têm que passar de verdade nas funções de validação que o código usa: confira na implementação delas (dígito verificador, formato) antes de usar
- Prefira poucos testes certos (3 a 8) a muitos duvidosos
- Nada de rede, banco ou arquivo de verdade: use mocks se o código depender disso
- Testes em português nas descrições (it("soma os preços", ...))

Responda só com o arquivo completo dentro de um bloco \`\`\`ts.`;
}

export function buildFixPrompt(target: TestTarget, setup: TestSetup, testCode: string, failure: string, projectContext = ''): string {
  return `Um teste gerado está falhando.

Arquivo testado: ${target.sourceFile}
\`\`\`ts
${truncateForPrompt(target.source, MAX_SOURCE_CHARS)}
\`\`\`

Teste atual (${target.testFile}):
\`\`\`ts
${testCode}
\`\`\`

Saída do ${setup.framework}:
\`\`\`
${truncateForPrompt(failure, MAX_OUTPUT_CHARS)}
\`\`\`

${projectContext ? `${projectContext}\n` : ''}Import correto do arquivo testado (use exatamente):
${buildImportLines(target).join('\n')}

Decida a causa:
- Erro de import, de sintaxe, de tipo do TypeScript (TSxxxx), "is not a function" ou "Cannot find module" é SEMPRE culpa do TESTE: corrija o teste. Nunca diga que o código deveria exportar de outro jeito.
- Se a expectativa do teste não bate com o que o código faz e o código está certo, corrija a expectativa.
- Remova casos que passam valores que o tipo do parâmetro não aceita (null/undefined/NaN num "number[]", por exemplo).
- Se o teste chama de "válido" um dado que as funções de validação do projeto rejeitam (CPF com dígito verificador errado, e-mail sem domínio), o erro é do TESTE: troque o dado por um que passe de verdade nelas.
- Só se uma asserção de comportamento falhou E você consegue apontar a linha do código que está errada (ex.: média dividindo pelo número errado), é BUG REAL: NÃO mude a expectativa; comece a resposta com uma linha "BUG: <a linha errada e por quê>" e depois o teste. Sem apontar a linha, não é bug: corrija o teste.

Responda com o arquivo de teste completo dentro de um bloco \`\`\`ts (com a linha BUG: antes, se for o caso).`;
}

export interface ParsedTestAnswer {
  code: string | null;
  bug: string | null;
}

// Largest fenced block; or the whole answer when it clearly is test code without a fence.
export function parseTestAnswer(response: string): ParsedTestAnswer {
  const clean = cleanAnswer(response);
  const bug = clean.match(/^\s*BUG:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const blocks = [...clean.matchAll(/```[\w-]*\r?\n([\s\S]*?)```/g)].map((match) => match[1].trim());
  const largest = blocks.sort((a, b) => b.length - a.length)[0];

  if (largest) return { code: `${largest}\n`, bug };
  if (/\b(describe|it|test)\s*\(/.test(clean)) return { code: `${clean.replace(/^\s*BUG:.*$/m, '').trim()}\n`, bug };
  return { code: null, bug };
}
