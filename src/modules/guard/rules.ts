import path from 'path';
import { luhn, isCpf, isCnpj, entropy } from './validators';
import type { AddedLine } from '@utils/diff';
import type { GuardFinding, GuardSeverity } from '@ktypes/guard';

// Deterministic by specification (Doc/ideas/novos-modulos.md §1): a security gate must not depend on
// a model's mood. Only the dubious high-entropy strings go to the AI (see index.ts).

interface LineRule {
  id: string;
  severity: GuardSeverity;
  description: string;
  pattern: RegExp;
  // extra check on the matched text (checksum, placeholder filter)
  accept?: (match: string) => boolean;
}

const PLACEHOLDER = /^(x+|\*+|changeme|change-me|your[_-]?\w*|example\w*|placeholder|todo|test|dummy|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\})$/i;

function isRealValue(assignment: string): boolean {
  const value = assignment.replace(/^[^:=]*[:=]\s*['"`]?/, '').replace(/['"`;,]*$/, '');
  return value.length >= 8 && !PLACEHOLDER.test(value) && !/process\.env|import\.meta\.env/.test(assignment);
}

const LINE_RULES: LineRule[] = [
  { id: 'aws-key', severity: 'block', description: 'chave de acesso AWS', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'google-api-key', severity: 'block', description: 'chave de API do Google', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'google-auth-key', severity: 'block', description: 'chave de API do Google (formato AQ.)', pattern: /\bAQ\.[0-9A-Za-z_-]{40,}/ },
  { id: 'groq-api-key', severity: 'block', description: 'chave de API do Groq', pattern: /\bgsk_[0-9A-Za-z]{40,}\b/ },
  { id: 'github-token', severity: 'block', description: 'token do GitHub', pattern: /\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: 'stripe-live-key', severity: 'block', description: 'chave live do Stripe', pattern: /\b(sk|rk)_live_[0-9a-zA-Z]{16,}\b/ },
  { id: 'private-key', severity: 'block', description: 'chave privada', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { id: 'jwt', severity: 'block', description: 'token JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    id: 'secret-assignment',
    severity: 'block',
    description: 'senha/segredo atribuído direto no código',
    pattern: /\b[\w.-]*(password|passwd|senha|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)[\w.-]*['"]?\s*[:=]\s*['"`][^'"`\s]+['"`]/i,
    accept: isRealValue,
  },
  {
    id: 'card-number',
    severity: 'block',
    description: 'número de cartão válido (Luhn)',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/,
    accept: luhn,
  },
  {
    id: 'cpf',
    severity: 'warn',
    description: 'CPF válido',
    pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
    accept: isCpf,
  },
  {
    id: 'cnpj',
    severity: 'warn',
    description: 'CNPJ válido',
    pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/,
    accept: isCnpj,
  },
  {
    id: 'sensitive-log',
    severity: 'warn',
    description: 'log com dado sensível',
    pattern: /console\.(log|info|debug|warn|error)\([^)]*\b(token|password|senha|secret|card|cartao|cvv|cpf|cnpj)\w*/i,
  },
];

interface FileRule {
  id: string;
  description: string;
  test: (fileName: string) => boolean;
}

const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist|defaults)$/i;

const FILE_RULES: FileRule[] = [
  { id: 'env-file', description: 'arquivo .env no stage', test: (name) => (name === '.env' || name.startsWith('.env.')) && !ENV_TEMPLATE.test(name) },
  { id: 'key-file', description: 'arquivo de chave/certificado', test: (name) => /\.(pem|p12|pfx|key|keystore|jks)$/i.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name) },
  { id: 'firebase-config', description: 'configuração do Firebase com chaves', test: (name) => name === 'google-services.json' || name === 'GoogleService-Info.plist' },
];

export function mask(value: string): string {
  const clean = value.trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

// What the report shows: never the secret itself.
function describeMatch(ruleId: string, matched: string, lineText: string): string {
  if (ruleId === 'sensitive-log') return lineText.trim().slice(0, 80);
  if (ruleId === 'secret-assignment') {
    const parts = matched.match(/^([^:=]*?)\s*[:=]\s*['"`]?([^'"`]*)/);
    if (parts) return `${parts[1].replace(/['"]/g, '').trim()} = ${mask(parts[2])}`;
  }
  return mask(matched);
}

export function checkStagedFiles(files: string[]): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const file of files) {
    const name = path.basename(file);
    for (const rule of FILE_RULES) {
      if (!rule.test(name)) continue;
      findings.push({ ruleId: rule.id, severity: 'block', filePath: file, lineNumber: null, description: rule.description, excerpt: name, match: file });
    }
  }
  return findings;
}

export function checkAddedLines(lines: AddedLine[]): GuardFinding[] {
  const findings: GuardFinding[] = [];

  for (const line of lines) {
    for (const rule of LINE_RULES) {
      const found = line.text.match(rule.pattern);
      if (!found) continue;
      if (rule.accept && !rule.accept(found[0])) continue;

      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        filePath: line.filePath,
        lineNumber: line.lineNumber,
        description: rule.description,
        excerpt: describeMatch(rule.id, found[0], line.text),
        match: found[0],
      });
    }
  }

  return findings;
}

export interface EntropyCandidate {
  filePath: string;
  lineNumber: number;
  value: string;
  line: string;
}

const QUOTED = /['"`]([A-Za-z0-9+/=_\-.]{20,})['"`]/g;
const MIN_ENTROPY = 4.0;

// Long random-looking quoted strings that no rule recognised: the AI decides if they are secrets.
export function findHighEntropyStrings(lines: AddedLine[], alreadyFlagged: GuardFinding[]): EntropyCandidate[] {
  const flaggedLines = new Set(alreadyFlagged.map((finding) => `${finding.filePath}:${finding.lineNumber}`));
  const candidates: EntropyCandidate[] = [];

  for (const line of lines) {
    if (flaggedLines.has(`${line.filePath}:${line.lineNumber}`)) continue;
    for (const match of line.text.matchAll(QUOTED)) {
      const value = match[1];
      const looksLikePathOrUrl = /^(https?:|\.{0,2}\/)|\.(ts|tsx|js|png|svg|json)$/i.test(value);
      if (looksLikePathOrUrl || entropy(value) < MIN_ENTROPY) continue;
      candidates.push({ filePath: line.filePath, lineNumber: line.lineNumber, value, line: line.text.trim() });
    }
  }

  return candidates;
}
