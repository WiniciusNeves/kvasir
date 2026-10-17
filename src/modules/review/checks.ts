// Deterministic review checks over the ADDED lines of a diff. They run before the AI because a
// local 7B model misses obvious things (off-by-one, hardcoded secrets) and invents others.

export interface AddedLine {
  filePath: string;
  lineNumber: number;
  text: string;
}

interface CheckRule {
  kind: 'bug' | 'segurança' | 'estilo';
  pattern: RegExp;
  problem: string;
  suggestion: string;
}

const RULES: CheckRule[] = [
  {
    kind: 'segurança',
    pattern: /(api[_-]?key|secret|token|password|senha)\w*\s*[:=]\s*['"`][^'"`\s]{6,}/i,
    problem: 'credencial escrita direto no código',
    suggestion: 'mova para variável de ambiente e gere uma chave nova',
  },
  {
    kind: 'bug',
    pattern: /for\s*\(.*<=\s*[\w.]+\.length\b/,
    problem: '"<= .length" percorre um índice além do fim do array',
    suggestion: 'use "<" em vez de "<="',
  },
  {
    kind: 'estilo',
    pattern: /:\s*any\b|<any>|as\s+any\b/,
    problem: 'uso de "any"',
    suggestion: 'declare o tipo correto (ou "unknown" + validação)',
  },
  {
    kind: 'estilo',
    pattern: /\bconsole\.log\(/,
    problem: 'console.log esquecido',
    suggestion: 'remova ou troque pelo logger do projeto',
  },
  {
    kind: 'bug',
    pattern: /\bdebugger\b/,
    problem: '"debugger" esquecido',
    suggestion: 'remova',
  },
];

export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let filePath = '';
  let lineNumber = 0;

  for (const line of diff.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('+++ ')) {
      filePath = line.replace(/^\+\+\+ (b\/)?/, '').trim();
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNumber = parseInt(hunk[1], 10);
      continue;
    }

    if (line.startsWith('+')) {
      added.push({ filePath, lineNumber, text: line.slice(1) });
      lineNumber += 1;
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      lineNumber += 1;
    }
  }

  return added;
}

export function runReviewChecks(diff: string): string[] {
  const findings: string[] = [];

  for (const added of parseAddedLines(diff)) {
    for (const rule of RULES) {
      if (rule.pattern.test(added.text)) {
        findings.push(`- [${rule.kind}] ${added.filePath}:${added.lineNumber} — ${rule.problem} — ${rule.suggestion}`);
      }
    }
  }

  return findings;
}
