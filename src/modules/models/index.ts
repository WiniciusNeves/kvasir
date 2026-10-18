import { listInstalledModels } from '@ai/ollama';
import { MODEL_MAP, CLOUD_MAP, cloudKeyFor, cloudModelFor, setCloudConsent } from '@ai/router';
import type { AiTask } from '@ai/router';
import type { CloudProvider } from '@ai/providers';
import { readMetrics, summarizeMetrics } from '@ai/metrics';
import { readUserConfig } from '@utils/userConfig';
import { confirm } from '@utils/prompt';
import { runKeysSet } from '@modules/keys';

export interface ModelsOptions {
  cloud?: string;
}

interface ModelStatusRow {
  model: string;
  status: string;
}

interface TaskModelRow {
  tarefa: AiTask;
  'responde primeiro': string;
  'ordem (fallback)': string;
}

const CLOUD_PROVIDERS: CloudProvider[] = ['gemini', 'groq'];

function isInstalled(model: string, installed: string[]): boolean {
  return installed.some((name) => name === model || name.startsWith(`${model}:`));
}

async function applyCloudOption(value: string): Promise<void> {
  const normalized = value.trim().toLowerCase();
  if (!['on', 'off'].includes(normalized)) throw new Error('Use "--cloud on" ou "--cloud off".');
  await setCloudConsent(normalized === 'on');
  console.log(normalized === 'on' ? '☁️  Nuvem permitida.' : '🔒 Nuvem desligada: tudo roda no Ollama local.');

  if (normalized === 'on' && !CLOUD_PROVIDERS.some((provider) => cloudKeyFor(provider))) {
    console.log('Mas ainda não há chave do Gemini nem do Groq.');
    if (await confirm('Salvar uma chave agora (kvasir keys set)?')) await runKeysSet();
  }
}

// Which cloud providers would really be used right now (key present + consent).
async function activeCloudProviders(): Promise<{ consent: boolean | undefined; active: Set<CloudProvider> }> {
  const consent = (await readUserConfig()).ai?.cloud;
  const active = new Set<CloudProvider>(consent ? CLOUD_PROVIDERS.filter((provider) => cloudKeyFor(provider)) : []);
  return { consent, active };
}

async function printCloud(consent: boolean | undefined): Promise<void> {
  const label = consent === true ? '✅ permitida' : consent === false ? '🔒 desligada' : '❔ ainda não perguntado (pergunto no primeiro uso, se houver chave)';
  console.log(`\n☁️  IA na nuvem: ${label}`);
  for (const provider of CLOUD_PROVIDERS) {
    const key = cloudKeyFor(provider) ? 'chave definida' : `sem chave (kvasir keys set ${provider})`;
    console.log(`  - ${provider}: ${await cloudModelFor(provider)} · ${key}`);
  }
  console.log('  Ligar/desligar: kvasir models --cloud on | off');
}

export async function runModels(options: ModelsOptions = {}): Promise<void> {
  if (options.cloud) await applyCloudOption(options.cloud);

  let installed: string[] = [];
  try {
    installed = await listInstalledModels();
  } catch {
    console.log('⚠️  Não foi possível conectar ao Ollama em http://localhost:11434. Verifique se ele está rodando.\n');
  }

  console.log('📦 Modelos instalados no Ollama:');
  if (installed.length === 0) {
    console.log('  (nenhum modelo encontrado)');
  } else {
    installed.forEach((name) => console.log(`  - ${name}`));
  }

  const allModels = Array.from(new Set(Object.values(MODEL_MAP).flat()));
  const statusRows: ModelStatusRow[] = allModels.map((model) => ({
    model,
    status: isInstalled(model, installed) ? '✅ disponível' : '❌ indisponível',
  }));
  console.log('\n🔎 Status por modelo local:');
  console.table(statusRows);

  const { consent, active } = await activeCloudProviders();
  await printCloud(consent);

  const taskRows: TaskModelRow[] = [];
  for (const task of Object.keys(MODEL_MAP) as AiTask[]) {
    const cloud = [];
    for (const provider of CLOUD_MAP[task].filter((item) => active.has(item))) cloud.push(`${provider}/${await cloudModelFor(provider)}`);
    const local = MODEL_MAP[task].filter((model) => isInstalled(model, installed));
    const chain = [...cloud, ...local];
    taskRows.push({
      tarefa: task,
      'responde primeiro': chain[0] ?? '(nenhum disponível)',
      'ordem (fallback)': chain.join(' → ') || '—',
    });
  }

  console.log('\n🎯 Quem responde cada tarefa:');
  console.table(taskRows);

  await printPerformance();
}

const PERFORMANCE_DAYS = 30;

function formatApproval(approved: number, rejected: number): string {
  const total = approved + rejected;
  return total === 0 ? '—' : `${Math.round((approved / total) * 100)}% (${approved}/${total})`;
}

// Real usage from ~/.kvasir/metrics: the data the router will use to pick models.
async function printPerformance(): Promise<void> {
  const summary = summarizeMetrics(await readMetrics(PERFORMANCE_DAYS));

  console.log(`\n📈 Desempenho nos últimos ${PERFORMANCE_DAYS} dias:`);
  if (summary.models.length === 0) {
    console.log('  (nenhuma chamada registrada ainda)');
  } else {
    console.table(
      summary.models.map((row) => ({
        tarefa: row.task,
        modelo: row.provider === 'ollama' ? row.model : `${row.provider}/${row.model}`,
        chamadas: row.calls,
        falhas: row.failures,
        'tempo médio (s)': row.avgSeconds.toFixed(1),
        'tokens de saída': row.avgOutputTokens === null ? '—' : Math.round(row.avgOutputTokens),
        aprovação: formatApproval(row.approved, row.rejected),
      }))
    );
  }

  console.log(
    `Claude via clipboard: ${summary.claude.roundTrips} ida(s) e volta(s), ~${Math.round(summary.claude.promptChars / 4).toLocaleString('pt-BR')} tokens enviados (estimativa: caracteres ÷ 4)`
  );
}
