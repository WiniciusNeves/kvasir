import { listInstalledModels } from '@ai/ollama';
import { MODEL_MAP, AiTask } from '@ai/router';
import { readMetrics, summarizeMetrics } from '@ai/metrics';

interface ModelStatusRow {
  model: string;
  status: string;
}

interface TaskModelRow {
  task: AiTask;
  activeModel: string;
  fallbackChain: string;
}

function isInstalled(model: string, installed: string[]): boolean {
  return installed.some((name) => name === model || name.startsWith(`${model}:`));
}

export async function runModels(): Promise<void> {
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

  console.log('\n🔎 Status por modelo:');
  console.table(statusRows);

  const taskRows: TaskModelRow[] = (Object.keys(MODEL_MAP) as AiTask[]).map((task) => {
    const chain = MODEL_MAP[task];
    const activeModel = chain.find((model) => isInstalled(model, installed)) ?? '(nenhum disponível)';

    return {
      task,
      activeModel,
      fallbackChain: chain.join(' → '),
    };
  });

  console.log('\n🎯 Modelo ativo por tarefa:');
  console.table(taskRows);

  await printPerformance();
}

const PERFORMANCE_DAYS = 30;

function formatApproval(approved: number, rejected: number): string {
  const total = approved + rejected;
  return total === 0 ? '—' : `${Math.round((approved / total) * 100)}% (${approved}/${total})`;
}

// Real usage from ~/.kvasir/metrics: the data the router will use to pick models (onda C).
async function printPerformance(): Promise<void> {
  const summary = summarizeMetrics(await readMetrics(PERFORMANCE_DAYS));

  console.log(`\n📈 Desempenho nos últimos ${PERFORMANCE_DAYS} dias:`);
  if (summary.models.length === 0) {
    console.log('  (nenhuma chamada registrada ainda)');
  } else {
    console.table(
      summary.models.map((row) => ({
        tarefa: row.task,
        modelo: row.model,
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
