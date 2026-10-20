import os from 'os';
import path from 'path';
import fs from 'fs';
import { askLocal } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { queueJobs, clearQueuedJobs } from '@ai/jobs';
import { checkbox, select } from '@utils/prompt';
import { getRepoRoot } from '@utils/git';
import { lineDiff, formatDiff } from '@utils/diff';
import { openDiffInEditor } from '@utils/editor';
import { collectDocsFacts } from './facts';
import type { DocCandidate, DocsFacts } from './facts';
import { buildDocsPrompt, parseDocsAnswer, MAX_SECTION_LINES, WHOLE_DOC_MAX_LINES } from './prompt';
import type { SectionEdit } from './prompt';
import { appendSection, parseSections, replaceSection, sectionBody, splitLines } from './sections';

// kvasir docs update: the README and the docs folder follow the code. Code finds what changed since
// the docs were last committed; the Documentador writes section edits; every file is shown as a diff
// and only written after the user approves it (backup in ~/.kvasir/backups/docs).

export interface DocsUpdateOptions {
  since?: string;
}

type Review = 'apply' | 'vscode' | 'skip';

const HEADING_LINE = /^#{1,6}\s+\S/;

function backupDir(): string {
  return path.join(os.homedir(), '.kvasir', 'backups', 'docs');
}

// Output checks (not workarounds): an edit that would delete subsections, or rewrite a section the
// model only saw part of, would lose text the model never read.
function checkEdit(doc: DocCandidate, edit: SectionEdit): string | null {
  if (edit.isNew) return null;
  const { lines } = splitLines(doc.content);
  const section = parseSections(lines).find((item) => item.heading === edit.heading);
  if (!section) return `a seção "${edit.heading}" não existe no documento`;

  const body = sectionBody(lines, section).split('\n');
  if (lines.length > WHOLE_DOC_MAX_LINES && body.length > MAX_SECTION_LINES) return `a seção "${edit.heading}" é maior do que o modelo viu`;

  const before = body.filter((line) => HEADING_LINE.test(line)).map((line) => line.trim());
  const after = new Set(edit.body.split('\n').filter((line) => HEADING_LINE.test(line)).map((line) => line.trim()));
  const lost = before.filter((heading) => !after.has(heading));
  return lost.length > 0 ? `a proposta apagava as subseções ${lost.join(', ')}` : null;
}

function applyEdits(doc: DocCandidate, edits: SectionEdit[]): { lines: string[]; applied: number } {
  let { lines } = splitLines(doc.content);
  let applied = 0;
  for (const edit of edits) {
    const refused = checkEdit(doc, edit);
    if (refused) {
      console.log(`   ⚠️  Ignorei uma parte: ${refused}.`);
      continue;
    }
    const next = edit.isNew ? appendSection(lines, edit.heading, edit.body) : replaceSection(lines, edit.heading, edit.body);
    if (next) {
      lines = next;
      applied += 1;
    }
  }
  return { lines, applied };
}

async function reviewFile(root: string, doc: DocCandidate, proposed: string): Promise<boolean> {
  for (;;) {
    const choice = await select<Review>(`Aplicar em ${doc.file}?`, [
      { name: 'Sim, aplicar', value: 'apply' },
      { name: 'Ver lado a lado no VS Code', value: 'vscode' },
      { name: 'Não, pular este arquivo', value: 'skip' },
    ]);
    if (choice === 'skip') return false;
    if (choice === 'apply') break;

    const preview = path.join(os.tmpdir(), `kvasir-docs-${path.basename(doc.file)}`);
    fs.writeFileSync(preview, proposed);
    openDiffInEditor(path.join(root, doc.file), preview);
  }

  fs.mkdirSync(backupDir(), { recursive: true });
  fs.copyFileSync(path.join(root, doc.file), path.join(backupDir(), `${Date.now()}-${path.basename(doc.file)}`));
  fs.writeFileSync(path.join(root, doc.file), proposed);
  return true;
}

async function chooseDocs(docs: DocCandidate[]): Promise<DocCandidate[]> {
  docs.forEach((doc) => console.log(`  - ${doc.file}${doc.mentioned.length > 0 ? ` (${doc.mentioned.length} seção(ões) citam o que mudou)` : ''}`));
  const how = await select<'all' | 'pick' | 'cancel'>('Quais documentos revisar?', [
    { name: `Todos (${docs.length})`, value: 'all' },
    { name: 'Escolher', value: 'pick' },
    { name: 'Cancelar', value: 'cancel' },
  ]);
  if (how === 'cancel') return [];
  if (how === 'all') return docs;
  const picked = await checkbox<string>('Marque os documentos:', docs.map((doc) => ({ name: doc.file, value: doc.file })));
  return docs.filter((doc) => picked.includes(doc.file));
}

async function updateDoc(root: string, doc: DocCandidate, facts: DocsFacts): Promise<'applied' | 'skipped' | 'nothing'> {
  console.log(`\n📝 ${doc.file}: pedindo ao Documentador…`);
  const answer = parseDocsAnswer(await askLocal('docs', buildDocsPrompt(doc, facts), { temperature: 0.1, maxTokens: 3000 }));
  if (answer === 'nothing') {
    console.log(`✔ ${doc.file}: nada a mudar.`);
    return 'nothing';
  }
  if (answer.length === 0) {
    console.log(`⚠️  ${doc.file}: a resposta não veio no formato de seções; pulei.`);
    await recordOutcome('docs', 'rejected');
    return 'skipped';
  }

  const { lines, applied } = applyEdits(doc, answer);
  const before = splitLines(doc.content).lines;
  const diff = lineDiff(before, lines);
  if (applied === 0 || diff.every((line) => line.type === ' ')) {
    console.log(`✔ ${doc.file}: nenhuma mudança aproveitável.`);
    return 'nothing';
  }

  console.log(formatDiff(diff));
  const eol = splitLines(doc.content).eol;
  // keep the file's final newline (an edit to the last section would drop it)
  const joined = lines.join(eol).replace(/\s+$/, '');
  const proposed = /\r?\n$/.test(doc.content) ? `${joined}${eol}` : joined;
  const accepted = await reviewFile(root, doc, proposed);
  await recordOutcome('docs', accepted ? 'approved' : 'rejected');
  console.log(accepted ? `✅ ${doc.file} atualizado (backup em ~/.kvasir/backups/docs).` : `⏭️  ${doc.file} ficou como estava.`);
  return accepted ? 'applied' : 'skipped';
}

export async function runDocsUpdate(options: DocsUpdateOptions = {}): Promise<void> {
  const root = getRepoRoot(process.cwd());
  if (!root) throw new Error('O docs update precisa de um repositório git (é por ele que sei o que mudou desde a última documentação).');

  const facts = collectDocsFacts(root, options.since);
  if (!facts) {
    console.log(options.since ? `Não encontrei a referência "${options.since}" ou nenhum documento (README.md, Doc/, docs/).` : 'Não encontrei documentação commitada (README.md ou a pasta Doc/docs) para comparar.');
    return;
  }

  const since = facts.baseIsDocsCommit ? `o último commit que mexeu na documentação (${facts.base.slice(0, 7)})` : facts.base;
  if (facts.changes.length === 0) {
    console.log(`✅ A documentação está em dia: nenhum arquivo de código mudou desde ${since}.`);
    return;
  }

  console.log(`📚 Desde ${since}: ${facts.commits.length} commit(s), ${facts.changes.length} arquivo(s) de código mudaram.`);
  if (facts.docs.length === 0) {
    console.log('Nenhum documento cita o que mudou.');
    return;
  }
  const docs = await chooseDocs(facts.docs);
  if (docs.length === 0) return;

  queueJobs('docs', docs.map((doc) => doc.file));
  const results: string[] = [];
  try {
    for (const doc of docs) results.push(await updateDoc(root, doc, facts));
  } finally {
    clearQueuedJobs('docs');
  }

  const applied = results.filter((result) => result === 'applied').length;
  console.log(`\n${applied} documento(s) atualizado(s), ${results.length - applied} sem mudança.`);
  if (applied > 0) console.log('Revise e commite quando quiser: kvasir commit');
}
