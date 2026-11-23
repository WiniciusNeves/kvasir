import { askFor } from '@ai/router';
import { answerLines } from '@ai/parse';
import { recordOutcome } from '@ai/metrics';
import { recordExample } from '@ai/examples';
import { recordFeedback } from '@utils/feedback';
import { askReason, confirm, editor, select } from '@utils/prompt';
import { getCommitsSince, getLastCommits, getLastTag, refExists } from '@utils/git';
import { noteDeploy } from '@modules/knowledge/auto';
import type { EasBuildProfile, EasConfig } from '@ktypes/deploy';
import { lastFinishedBuild, recentUpdateMessages, runEas } from './easCli';
import type { EasBuildInfo } from './easCli';
import { nativeChangesSince } from './native';
import { hasDependency } from './detect';
import type { DeployPackageJson } from './detect';

const MAX_COMMITS_IN_PROMPT = 30;
const COMMITS_WITHOUT_BASE = 15;
// `eas update` requires --environment from this Expo SDK on
const SDK_NEEDS_ENVIRONMENT = 55;
const EAS_ENVIRONMENTS = ['production', 'preview', 'development'];
const MERGE_COMMIT = /^Merge (pull request|branch|remote-tracking)/;

type MessageChoice = 'yes' | 'edit' | 'no';

function expoSdkMajor(pkg: DeployPackageJson | null): number | null {
  const version = pkg?.dependencies?.expo ?? pkg?.devDependencies?.expo ?? '';
  const major = parseInt(version.replace(/^[^\d]*/, ''), 10);
  return Number.isNaN(major) ? null : major;
}

async function pickChannel(eas: EasConfig): Promise<{ channel: string; profile: EasBuildProfile }> {
  const withChannel = eas.buildProfiles.filter((profile) => profile.channel);
  const channels = [...new Set(withChannel.map((profile) => profile.channel as string))];
  const channel = channels.length === 1 ? channels[0] : await select('Publicar o update em qual canal?', channels.map((name) => ({ name, value: name })));
  return { channel, profile: withChannel.find((profile) => profile.channel === channel) as EasBuildProfile };
}

// Shows what changed since the build the update would reach. True when it is fine to go on.
async function checkNativeChanges(channel: string, build: EasBuildInfo | null): Promise<boolean> {
  if (!build) {
    console.log(`⚠️  Não achei build terminado no canal "${channel}": o update só chega em apps instalados de um build desse canal.`);
    return confirm('Continuar mesmo assim?');
  }
  console.log(`Último build do canal: ${build.platform}, ${build.createdAt.slice(0, 10)}${build.runtimeVersion ? `, runtime ${build.runtimeVersion}` : ''}.`);
  if (!build.commit) {
    console.log('⚠️  O EAS não guardou o commit desse build: não dá para conferir se algo nativo mudou.');
    return true;
  }

  const changes = await nativeChangesSince(build.commit);
  if (!changes.comparable) {
    console.log(`⚠️  O commit do build (${build.commit.slice(0, 7)}) não está neste clone: não dá para conferir se algo nativo mudou.`);
    return true;
  }
  if (changes.dependencies.length > 0) {
    console.log(`Dependências que mudaram desde o build: ${changes.dependencies.join(', ')}`);
    console.log('   Se alguma tem código nativo, o update não basta: precisa de um build novo.');
  }
  if (changes.files.length === 0) {
    if (changes.dependencies.length === 0) console.log('✅ Nada nativo mudou desde o build: um update OTA serve.');
    return true;
  }
  console.log(`⛔ Mudou código nativo ou a config do app desde o build: ${changes.files.join(', ')}`);
  console.log('   Um update OTA não leva isso. O certo é um build novo (kvasir deploy → Build).');
  return confirm('Publicar o update mesmo assim (só a parte JavaScript vai)?');
}

function commitSubjects(build: EasBuildInfo | null): string[] {
  const base = build?.commit && refExists(build.commit) ? build.commit : getLastTag();
  const lines = base ? getCommitsSince(base) : getLastCommits(COMMITS_WITHOUT_BASE);
  return lines
    .map((line) => line.replace(/^\S+\s+/, ''))
    .filter((subject) => subject && !MERGE_COMMIT.test(subject))
    .slice(-MAX_COMMITS_IN_PROMPT);
}

const PORTUGUESE_MARKERS = /[ãõçáéíóúâêô]|\b(de|para|com|não|na|no|da|do|que|uma?)\b/i;

// The language is a known fact, passed to the model: asked "in the language of the commits", qwen answered
// in Portuguese (the prompt's language) for English commits. From the project's commit rules when there is a
// kvasir.context.md; otherwise from the developer's own messages and commits.
async function messageLanguage(subjects: string[], previous: string[]): Promise<'português' | 'inglês'> {
  try {
    const { readContext } = await import('@modules/init/contextWriter');
    return /portugu/i.test((await readContext()).commitRules.language) ? 'português' : 'inglês';
  } catch {
    const texts = previous.length > 0 ? previous : subjects;
    const portuguese = texts.filter((text) => PORTUGUESE_MARKERS.test(text)).length;
    return portuguese * 2 > texts.length ? 'português' : 'inglês';
  }
}

// Data first, the exact output last. The developer's previous messages on the channel carry the style.
// Asked for "a summary", qwen wrote "bug fixes and improvements" for 30 commits; asked for the 1-2 changes
// the user notices, by name, it wrote a line someone can act on.
function buildUpdatePrompt(subjects: string[], previous: string[], language: string): string {
  return `Commits que vão neste update OTA do app (do mais antigo para o mais novo):
${subjects.map((subject) => `- ${subject}`).join('\n')}
${previous.length > 0 ? `\nMensagens dos updates anteriores deste desenvolvedor neste canal:\n${previous.map((message) => `- ${message}`).join('\n')}\n` : ''}
Escreva a mensagem deste update: UMA linha curta (até 72 caracteres) que diz as 1 ou 2 mudanças que o usuário do app mais vai notar, com o nome delas (tela, recurso). Frases genéricas como "correções e melhorias" não servem: quem lê precisa saber o que mudou. ${
    previous.length > 0 ? 'Siga o estilo das mensagens anteriores. ' : ''
  }Escreva em ${language}.

Responda só com a linha, sem aspas e sem explicação.`;
}

function parseUpdateMessage(response: string): string {
  return (answerLines(response)[0] ?? response.trim()).replace(/^(mensagem|message)\s*:\s*/i, '').trim();
}

async function pickEnvironment(profile: EasBuildProfile, channel: string): Promise<string> {
  const preferred = profile.environment ?? (EAS_ENVIRONMENTS.includes(channel) ? channel : undefined);
  const ordered = preferred ? [preferred, ...EAS_ENVIRONMENTS.filter((name) => name !== preferred)] : EAS_ENVIRONMENTS;
  return select('Ambiente do EAS (variáveis do servidor) para este update:', ordered.map((name) => ({ name, value: name })));
}

// The AI writes the message; the developer approves, edits or refuses it (that verdict trains the router
// and the examples); publishing is a second, separate confirmation with the exact command.
export async function runEasUpdate(eas: EasConfig, pkg: DeployPackageJson | null): Promise<void> {
  const { channel, profile } = await pickChannel(eas);

  console.log(`\nConsultando o EAS sobre o canal "${channel}"...`);
  const build = lastFinishedBuild(channel);
  if (!(await checkNativeChanges(channel, build))) {
    console.log('Update cancelado.');
    return;
  }

  const subjects = commitSubjects(build);
  if (subjects.length === 0) {
    console.log('Nenhum commit novo desde o último build: não há o que publicar (commite as mudanças antes).');
    return;
  }
  const previous = recentUpdateMessages(channel);
  const about = `canal: ${channel} · commits: ${subjects.join(' | ')}`;

  console.log(`\nEscrevendo a mensagem com a IA local a partir de ${subjects.length} commit(s)...`);
  const language = await messageLanguage(subjects, previous);
  const message = parseUpdateMessage(await askFor('deploy', buildUpdatePrompt(subjects, previous, language), { temperature: 0.2, maxTokens: 120, examplesFor: about }));
  console.log(`\nMensagem: ${message}`);

  const choice = await select<MessageChoice>('Usar esta mensagem?', [
    { name: 'Sim', value: 'yes' },
    { name: 'Editar', value: 'edit' },
    { name: 'Não — cancelar', value: 'no' },
  ]);
  if (choice === 'no') {
    const reason = await askReason();
    await recordFeedback('deploys', 'rejected', `update ${channel}: ${message}`, reason);
    await recordOutcome('deploy', 'rejected');
    await recordExample('deploy', { input: about, output: message, decision: 'rejected', reason });
    console.log('Update cancelado.');
    return;
  }
  const finalMessage = choice === 'edit' ? (await editor('Mensagem do update', message)).trim() || message : message;
  const verdict = finalMessage === message ? 'approved' : 'rejected';
  await recordFeedback('deploys', verdict, verdict === 'approved' ? `update ${channel}: ${message}` : `update ${channel}: ${message} → editada para ${finalMessage}`);
  await recordOutcome('deploy', verdict);
  await recordExample('deploy', { input: about, output: finalMessage, suggested: message, decision: verdict === 'approved' ? 'approved' : 'edited' });

  const needsEnvironment = (expoSdkMajor(pkg) ?? 0) >= SDK_NEEDS_ENVIRONMENT || Boolean(profile.environment);
  const environment = needsEnvironment ? await pickEnvironment(profile, channel) : null;
  const args = ['update', '--channel', channel, '--message', finalMessage, ...(environment ? ['--environment', environment] : [])];
  if (!hasDependency(pkg, 'expo-updates')) console.log('⚠️  O projeto não tem expo-updates: os apps não vão receber este update.');

  console.log(`\nComando: eas ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}`);
  if (!(await confirm(`Publicar o update no canal "${channel}"?`))) {
    console.log('Nada foi publicado.');
    return;
  }
  if (channel === 'production' && !(await confirm('É o canal de produção: os usuários recebem na próxima abertura do app. Confirma?'))) {
    console.log('Nada foi publicado.');
    return;
  }

  if (!runEas(args)) {
    console.log('O eas update falhou (a saída do EAS está acima). Nada foi registrado.');
    return;
  }
  console.log(`✅ Update publicado no canal "${channel}".`);
  await noteDeploy('eas update', channel, finalMessage);
}
