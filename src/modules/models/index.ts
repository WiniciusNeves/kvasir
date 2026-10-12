import { listInstalledModels } from '@ai/ollama';
import { MODEL_MAP, AiTask } from '@ai/router';

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
}
