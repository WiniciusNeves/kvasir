// The agent team (backlog block 4). Every AI task has exactly ONE owner agent: the router only
// hands a task to its owner's models, with the owner's role prompt and nothing from other agents
// (isolated context). Agents are swappable from ~/.kvasir/config.json (`agents.<name>.models`,
// `agents.<name>.cloud`) without touching any module.

import type { AiTask } from '@ai/router';

export type AgentName = 'architect' | 'reviewer' | 'documenter' | 'tester' | 'executor';

export interface AgentDefinition {
  name: AgentName;
  // Portuguese, for the console
  label: string;
  role: string;
  // short role prompt put at the top of every prompt of this agent
  rolePrompt: string;
}

export const AGENTS: Record<AgentName, AgentDefinition> = {
  architect: {
    name: 'architect',
    label: 'Arquiteto',
    role: 'causa raiz e decisões técnicas',
    rolePrompt:
      'Você é o Arquiteto do time Kvasir: investiga a causa raiz e toma decisões técnicas. Olhe o sistema todo (imports, configuração, versões) antes de concluir e aponte a causa, não só o sintoma.',
  },
  reviewer: {
    name: 'reviewer',
    label: 'Revisor',
    role: 'review, correção de erros e checagem de segredos',
    rolePrompt:
      'Você é o Revisor do time Kvasir: avalia e corrige código com rigor. Só aponte ou corrija o que o código mostrado comprova; nunca invente problema, API ou arquivo.',
  },
  documenter: {
    name: 'documenter',
    label: 'Documentador',
    role: 'documentação, PR, daily e notas de versão',
    rolePrompt:
      'Você é o Documentador do time Kvasir: escreve textos claros e diretos para pessoas. Afirme só o que está nos dados recebidos; não acrescente funcionalidade, número ou detalhe que não esteja lá.',
  },
  tester: {
    name: 'tester',
    label: 'Testador',
    role: 'gera e revisa testes',
    rolePrompt:
      'Você é o Testador do time Kvasir: escreve testes que passam e que pegariam bugs reais. Use exatamente os imports, nomes e tipos mostrados; não teste comportamento que o código não tem.',
  },
  executor: {
    name: 'executor',
    label: 'Executor',
    role: 'commit, branch e comandos',
    rolePrompt:
      'Você é o Executor do time Kvasir: faz tarefas curtas e exatas. Responda somente no formato pedido, sem explicação, sem rótulos e sem crases.',
  },
};

// Single owner per task. A Record, so a new AiTask without an owner does not compile.
export const TASK_OWNER: Record<AiTask, AgentName> = {
  architect: 'architect',
  review: 'reviewer',
  fix: 'reviewer',
  guard: 'reviewer',
  doc: 'documenter',
  pr: 'documenter',
  daily: 'documenter',
  release: 'documenter',
  test: 'tester',
  commit: 'executor',
  branch: 'executor',
  intent: 'executor',
};

export const AGENT_NAMES = Object.keys(AGENTS) as AgentName[];

export function agentForTask(task: AiTask): AgentDefinition {
  return AGENTS[TASK_OWNER[task]];
}

export function tasksOf(agent: AgentName): AiTask[] {
  return (Object.keys(TASK_OWNER) as AiTask[]).filter((task) => TASK_OWNER[task] === agent);
}
