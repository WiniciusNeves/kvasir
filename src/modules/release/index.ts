import { askLocal } from '@ai/router';
import { writeClipboard } from '@ai/client';
import { cleanAnswer } from '@ai/parse';
import { recordOutcome } from '@ai/metrics';
import { confirm, input, select } from '@utils/prompt';
import { readFile, writeFile, readJson } from '@utils/fs';
import {
  getDiff,
  getLastTag,
  getCommitsWithBody,
  getChangedPaths,
  getCurrentBranch,
  refExists,
  stageFiles,
  commitWithMessage,
  createAnnotatedTag,
  getUpstream,
  pushBranchWithTags,
} from '@utils/git';
import { noteRelease } from '@modules/knowledge/auto';
import { parseCommit, detectBump, bumpVersion, isValidVersion } from './semver';
import type { Bump, ParsedCommit } from './semver';
import { buildChangelogSection, prependChangelog } from './changelog';
import { readPackageVersion, applyVersion, findDynamicExpoConfig } from './versionFiles';

const CHANGELOG_FILE = 'CHANGELOG.md';
const VERSION_FILES = ['package.json', 'package-lock.json', 'app.json', CHANGELOG_FILE];

type VersionChoice = Bump | 'custom' | 'cancel';

interface ExpoPackage {
  dependencies?: Record<string, string>;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// The release commit must contain only the release: nothing staged, no pending edits in the files it writes.
function assertCleanForRelease(): void {
  if (getDiff().trim()) {
    throw new Error('Há mudanças no stage. O commit de release teria que levar só a versão: commite ou tire do stage antes.');
  }

  const changed = getChangedPaths();
  const conflicting = changed.filter((file) => VERSION_FILES.includes(file));
  if (conflicting.length > 0) {
    throw new Error(`Há mudanças não commitadas em ${conflicting.join(', ')}. Commite ou descarte antes do release.`);
  }
}

function describeCommits(commits: ParsedCommit[]): string {
  const count = (predicate: (commit: ParsedCommit) => boolean): number => commits.filter(predicate).length;
  const parts = [
    `${count((commit) => commit.type === 'feat')} feat`,
    `${count((commit) => commit.type === 'fix')} fix`,
    `${count((commit) => commit.breaking)} breaking`,
  ];
  const unconventional = count((commit) => commit.unconventional);
  if (unconventional > 0) parts.push(`${unconventional} fora do padrão Conventional Commits`);
  return parts.join(' · ');
}

async function chooseVersion(current: string, suggested: Bump | null): Promise<string | null> {
  const order: Bump[] = suggested ? [suggested, ...(['major', 'minor', 'patch'] as Bump[]).filter((bump) => bump !== suggested)] : ['patch', 'minor', 'major'];

  const choice = await select<VersionChoice>(`Versão atual ${current}. Próxima versão:`, [
    ...order.map((bump) => ({
      name: `${bumpVersion(current, bump)} (${bump}${bump === suggested ? ', sugerida pelos commits' : ''})`,
      value: bump,
    })),
    { name: 'Outra (digitar)', value: 'custom' },
    { name: 'Cancelar', value: 'cancel' },
  ]);

  if (choice === 'cancel') return null;
  if (choice !== 'custom') return bumpVersion(current, choice);

  const typed = (await input('Versão (X.Y.Z):')).trim().replace(/^v/, '');
  if (!isValidVersion(typed)) throw new Error(`"${typed}" não é uma versão SemVer válida.`);
  return typed;
}

const USER_FACING = new Set(['feat', 'fix', 'perf']);

// Only what a user notices goes to the model, and the task is to rewrite each item (one in, one
// out). Asked to "summarize the changelog" with an example, llama3.2 copied the example's content
// and invented items.
function userFacingChanges(commits: ParsedCommit[]): string[] {
  return commits.filter((commit) => commit.breaking || USER_FACING.has(commit.type)).map((commit) => commit.description);
}

function buildNotesPrompt(version: string, changes: string[]): string {
  return `Mudanças da versão ${version} de um app (escritas por desenvolvedores, em inglês):
${changes.map((change, index) => `${index + 1}. ${change}`).join('\n')}

Reescreva para quem usa o app, em português do Brasil, linguagem simples e sem termos técnicos.
Responda exatamente assim:
- primeira linha: uma frase curta dizendo o que essa versão traz
- depois exatamente ${changes.length} item(ns), um para cada mudança numerada acima, na mesma ordem, começando com "- "
Não acrescente mudanças que não estão na lista.`;
}

async function offerReleaseNotes(version: string, commits: ParsedCommit[]): Promise<void> {
  const changes = userFacingChanges(commits);
  if (changes.length === 0) return;

  const wants = await confirm('Gerar notas de release em português com a IA (para loja/cliente)?');
  if (!wants) return;

  console.log('🤖 Escrevendo as notas...');
  const raw = cleanAnswer(await askLocal('release', buildNotesPrompt(version, changes), { temperature: 0.2 }));
  // "- - item" (doubled bullets from llama3.2) → "- item"; "**bold**" is left alone.
  const notes = raw.replace(/^([ \t]*[-*][ \t]+)+/gm, '- ');
  console.log(`\n${'─'.repeat(50)}\n${notes}\n${'─'.repeat(50)}`);

  const copy = await confirm('Copiar as notas para o clipboard?');
  await recordOutcome('release', copy ? 'approved' : 'rejected');
  if (copy) {
    await writeClipboard(notes);
    console.log('✅ Notas copiadas.');
  }
}

async function suggestEasUpdate(version: string, commits: ParsedCommit[]): Promise<void> {
  const pkg = await readJson<ExpoPackage>('package.json');
  if (!pkg?.dependencies?.expo) return;

  const highlight = commits.find((commit) => commit.type === 'feat') ?? commits.find((commit) => commit.type === 'fix');
  console.log('\n📱 Projeto Expo. Quando for publicar (integra com o futuro "kvasir deploy"):');
  console.log(`   eas update --branch production --message "v${version}${highlight ? `: ${highlight.description}` : ''}"`);

  const dynamic = await findDynamicExpoConfig();
  if (dynamic) console.log(`⚠️  ${dynamic} é código: confira se a versão lá também é ${version}.`);
}

export async function runRelease(): Promise<void> {
  assertCleanForRelease();

  const lastTag = getLastTag();
  const commits = getCommitsWithBody(lastTag).map(parseCommit).filter((commit) => !(commit.type === 'chore' && commit.scope === 'release'));
  if (commits.length === 0) {
    console.log(`Nenhum commit ${lastTag ? `desde ${lastTag}` : 'no repositório'}. Nada para lançar.`);
    return;
  }

  const current = (await readPackageVersion()) ?? lastTag?.replace(/^v/, '') ?? '0.0.0';
  const suggested = detectBump(commits);
  console.log(`\n🏷️  ${commits.length} commit(s) ${lastTag ? `desde ${lastTag}` : '(primeiro release)'}: ${describeCommits(commits)}`);
  if (!suggested) console.log('Só commits de manutenção (nenhum feat, fix, perf ou breaking): um release talvez não seja necessário.');

  const version = await chooseVersion(current, suggested);
  if (!version) {
    console.log('Release cancelado.');
    return;
  }

  const tag = `v${version}`;
  if (refExists(tag)) throw new Error(`A tag ${tag} já existe.`);

  const section = buildChangelogSection(version, today(), commits);
  console.log(`\n${CHANGELOG_FILE}:\n${'─'.repeat(50)}\n${section}\n${'─'.repeat(50)}`);

  const approved = await confirm(`Atualizar ${CHANGELOG_FILE} e a versão, commitar "chore(release): ${tag}" e criar a tag ${tag}?`);
  if (!approved) {
    console.log('Release cancelado. Nada foi alterado.');
    return;
  }

  await writeFile(CHANGELOG_FILE, prependChangelog(await readFile(CHANGELOG_FILE), section));
  const changes = await applyVersion(version);
  changes.forEach((change) => console.log(`  ✏️  ${change.file}: ${change.description}`));

  stageFiles([CHANGELOG_FILE, ...changes.map((change) => change.file)]);
  commitWithMessage(`chore(release): ${tag}`);
  createAnnotatedTag(tag, `${tag}\n\n${section}`);
  console.log(`✅ Commit e tag ${tag} criados.`);

  await noteRelease(version, section);
  await offerReleaseNotes(version, commits);
  await suggestEasUpdate(version, commits);

  const branch = getCurrentBranch();
  if (branch && getUpstream() && (await confirm(`Enviar o commit e a tag para o remoto (git push --follow-tags origin ${branch})?`))) {
    pushBranchWithTags(branch);
    console.log('✅ Enviado.');
  } else {
    console.log(`Quando quiser publicar: git push --follow-tags origin ${branch || '<branch>'}`);
  }
}
