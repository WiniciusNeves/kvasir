import { AGENTS, AGENT_NAMES, TASK_OWNER, tasksOf } from '@ai/agents';
import type { AgentName } from '@ai/agents';
import { MODEL_MAP, CLOUD_MAP } from '@ai/router';
import type { AiTask } from '@ai/router';
import { listInstalledModels } from '@ai/ollama';
import { readMetrics } from '@ai/metrics';
import type { AiCallRecord, AiOutcomeRecord } from '@ai/metrics';
import { PERFORMANCE_WINDOW_DAYS } from '@ai/performance';
import { confirm, select } from '@utils/prompt';
import { readUserConfig, updateUserConfig } from '@utils/userConfig';
import type { AgentSettings } from '@utils/userConfig';

const NONE = '__none__';

interface AgentRow {
  agente: string;
  função: string;
  tarefas: string;
  'modelos locais': string;
  nuvem: string;
  'chamadas (30d)': number;
  aprovação: string;
}

function parseAgent(value: string | undefined): AgentName | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const found = AGENT_NAMES.find((name) => name === normalized || AGENTS[name].label.toLowerCase() === normalized);
  if (!found) throw new Error(`Agente desconhecido "${value}". Use: ${AGENT_NAMES.join(', ')}.`);
  return found;
}

function defaultChain(agent: AgentName): string {
  const chains = Array.from(new Set(tasksOf(agent).map((task) => MODEL_MAP[task].join(' → '))));
  return chains.length === 1 ? chains[0] : `por tarefa (${chains.join(' | ')})`;
}

function cloudLabel(agent: AgentName, settings: AgentSettings): string {
  const allowed = tasksOf(agent).filter((task) => CLOUD_MAP[task].length > 0);
  if (allowed.length === 0) return 'nunca (fica na máquina)';
  if (settings.cloud === false) return 'desligada para este agente';
  return Array.from(new Set(allowed.flatMap((task) => CLOUD_MAP[task]))).join(', ');
}

export async function runAgents(): Promise<void> {
  const config = await readUserConfig();
  const records = await readMetrics(PERFORMANCE_WINDOW_DAYS);
  // agent from the task owner, so records from before the agent field count too
  const ownerOf = (task: string): AgentName | undefined => TASK_OWNER[task as AiTask];
  const calls = records.filter((record): record is AiCallRecord => record.type === 'call' && record.role === 'executor');
  const verdicts = records.filter((record): record is AiOutcomeRecord => record.type === 'outcome');

  const rows: AgentRow[] = AGENT_NAMES.map((name) => {
    const agent = AGENTS[name];
    const settings = config.agents?.[name] ?? {};
    const mine = verdicts.filter((verdict) => ownerOf(verdict.task) === name);
    const approved = mine.filter((verdict) => verdict.decision === 'approved').length;
    return {
      agente: agent.label,
      função: agent.role,
      tarefas: tasksOf(name).join(', '),
      'modelos locais': settings.models ? `${settings.models.join(' → ')} (seu)` : defaultChain(name),
      nuvem: cloudLabel(name, settings),
      'chamadas (30d)': calls.filter((call) => ownerOf(call.task) === name).length,
      aprovação: mine.length > 0 ? `${Math.round((approved / mine.length) * 100)}% (${approved}/${mine.length})` : '—',
    };
  });

  console.log('👥 Time de agentes: cada tarefa tem um único dono, com contexto próprio.\n');
  console.table(rows);
  console.log('Trocar os modelos de um agente: kvasir agents set [agente] · ordem real por tarefa: kvasir models');
}

async function chooseLocalModels(installed: string[]): Promise<string[] | null> {
  const chosen: string[] = [];
  const labels = ['Modelo principal', 'Fallback 1 (opcional)', 'Fallback 2 (opcional)'];
  for (const label of labels) {
    const remaining = installed.filter((name) => !chosen.includes(name));
    if (remaining.length === 0) break;
    const choice = await select<string>(`${label}:`, [
      ...remaining.map((name) => ({ name, value: name })),
      { name: chosen.length === 0 ? 'Cancelar' : 'Pronto (sem mais fallback)', value: NONE },
    ]);
    if (choice === NONE) break;
    chosen.push(choice.replace(/:latest$/, ''));
  }
  return chosen.length > 0 ? chosen : null;
}

async function saveAgentSettings(agent: AgentName, mutate: (settings: AgentSettings) => AgentSettings | undefined): Promise<void> {
  await updateUserConfig((config) => {
    const agents = { ...(config.agents ?? {}) };
    const next = mutate({ ...(agents[agent] ?? {}) });
    if (next && Object.keys(next).length > 0) agents[agent] = next;
    else delete agents[agent];
    if (Object.keys(agents).length > 0) config.agents = agents;
    else delete config.agents;
  });
}

export async function runAgentsSet(agentArg?: string): Promise<void> {
  const agent =
    parseAgent(agentArg) ??
    (await select<AgentName>(
      'Qual agente você quer ajustar?',
      AGENT_NAMES.map((name) => ({ name: `${AGENTS[name].label} (${AGENTS[name].role})`, value: name }))
    ));
  const definition = AGENTS[agent];
  const settings = (await readUserConfig()).agents?.[agent] ?? {};
  const cloudPossible = tasksOf(agent).some((task) => CLOUD_MAP[task].length > 0);

  console.log(`\n${definition.label}: ${definition.role}`);
  console.log(`Tarefas: ${tasksOf(agent).join(', ')}`);
  console.log(`Modelos locais: ${settings.models ? settings.models.join(' → ') : `padrão (${defaultChain(agent)})`}`);

  type Action = 'models' | 'cloud-off' | 'cloud-on' | 'reset' | 'cancel';
  const action = await select<Action>('O que você quer fazer?', [
    { name: 'Trocar os modelos locais (Ollama)', value: 'models' },
    ...(cloudPossible
      ? settings.cloud === false
        ? [{ name: 'Voltar a usar a nuvem neste agente', value: 'cloud-on' as const }]
        : [{ name: 'Não usar a nuvem neste agente (só Ollama)', value: 'cloud-off' as const }]
      : []),
    { name: 'Voltar tudo ao padrão', value: 'reset' },
    { name: 'Cancelar', value: 'cancel' },
  ]);

  if (action === 'cancel') return;

  if (action === 'models') {
    let installed: string[];
    try {
      installed = await listInstalledModels();
    } catch {
      throw new Error('Não foi possível conectar ao Ollama em http://localhost:11434. Verifique se ele está rodando.');
    }
    if (installed.length === 0) throw new Error('Nenhum modelo instalado no Ollama.');
    const models = await chooseLocalModels(installed);
    if (!models) return;
    if (!(await confirm(`Usar ${models.join(' → ')} em todas as tarefas do ${definition.label}?`))) return;
    await saveAgentSettings(agent, (current) => ({ ...current, models }));
    console.log(`✅ ${definition.label} agora usa ${models.join(' → ')} (salvo em ~/.kvasir/config.json).`);
    return;
  }

  if (action === 'reset') {
    if (!(await confirm(`Voltar o ${definition.label} ao padrão?`))) return;
    await saveAgentSettings(agent, () => undefined);
    console.log(`✅ ${definition.label} voltou ao padrão.`);
    return;
  }

  const cloud = action === 'cloud-on';
  await saveAgentSettings(agent, (current) => {
    const next = { ...current };
    if (cloud) delete next.cloud;
    else next.cloud = false;
    return next;
  });
  console.log(cloud ? `☁️  ${definition.label} volta a usar a nuvem (se ela estiver permitida).` : `🔒 ${definition.label} agora só usa o Ollama local.`);
}
