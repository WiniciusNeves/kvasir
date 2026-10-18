import { listInstalledModels } from '@ai/ollama';
import { MODEL_MAP } from '@ai/router';
import { probe, firstVersion } from './shared';
import type { CheckResult } from '@ktypes/doctor';

export interface OllamaCheck {
  results: CheckResult[];
  // models used by the router that aren't installed (offered for download by the runner)
  missing: string[];
}

function matchesInstalled(model: string, installed: string[]): boolean {
  return installed.some((name) => name === model || name.startsWith(`${model}:`));
}

export async function checkOllama(): Promise<OllamaCheck> {
  const cli = probe('ollama', ['--version']);
  let installed: string[];

  try {
    installed = await listInstalledModels();
  } catch {
    return {
      results: [
        cli.found
          ? { name: 'Ollama', status: 'fail', detail: `instalado (${firstVersion(cli.output) ?? '?'}), mas não está rodando em localhost:11434`, fix: 'Abra o app do Ollama ou rode "ollama serve"' }
          : { name: 'Ollama', status: 'fail', detail: 'não instalado', fix: 'Instale em ollama.com' },
      ],
      missing: [],
    };
  }

  const results: CheckResult[] = [{ name: 'Ollama', status: 'ok', detail: `rodando${cli.found ? ` (${firstVersion(cli.output) ?? '?'})` : ''}, ${installed.length} modelo(s)` }];
  const usedModels = Array.from(new Set(Object.values(MODEL_MAP).flat()));
  const missing = usedModels.filter((model) => !matchesInstalled(model, installed));

  for (const model of usedModels) {
    const tasks = Object.entries(MODEL_MAP)
      .filter(([, models]) => models.includes(model))
      .map(([task]) => task)
      .join(', ');
    results.push(
      missing.includes(model)
        ? { name: model, status: 'warn', detail: `não instalado (usado em: ${tasks})`, fix: `ollama pull ${model}` }
        : { name: model, status: 'ok', detail: `usado em: ${tasks}` }
    );
  }

  // A task whose whole fallback chain is missing can't run at all.
  for (const [task, models] of Object.entries(MODEL_MAP)) {
    if (models.every((model) => missing.includes(model))) {
      results.push({ name: `tarefa ${task}`, status: 'fail', detail: 'nenhum modelo da tarefa está instalado', fix: `ollama pull ${models[0]}` });
    }
  }

  return { results, missing };
}
