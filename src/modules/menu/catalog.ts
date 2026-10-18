// Every command the menu and the natural-language interpreter can run, described in Portuguese.
// `argv` is what goes to commander; `ask` asks for one more argument before running.

export interface CatalogAsk {
  message: string;
  required: boolean;
}

export interface CatalogEntry {
  argv: string[];
  label: string;
  // how the command is written for the interpreter prompt, when it takes an argument
  usage?: string;
  ask?: CatalogAsk;
  // opens a submenu instead of running (keys, persona, knowledge)
  submenu?: string;
}

export interface CatalogGroup {
  title: string;
  entries: CatalogEntry[];
}

export const MAIN_MENU: CatalogGroup[] = [
  {
    title: 'Dia a dia',
    entries: [
      { argv: ['start'], label: 'Começar o dia (task, branch e contexto)' },
      { argv: ['task'], label: 'Escolher a task ativa' },
      { argv: ['branch'], label: 'Criar uma branch para a task' },
      { argv: ['commit'], label: 'Gerar a mensagem de commit e commitar' },
      { argv: ['push'], label: 'Enviar/subir os commits para o repositório remoto (push)' },
      { argv: ['pr'], label: 'Abrir/criar o pull request (PR) com título e descrição' },
      { argv: ['daily'], label: 'Resumo para a daily (ontem, hoje, impedimentos)' },
      { argv: ['stats'], label: 'Estatísticas e painel dos agentes (abre no navegador)' },
      { argv: ['board'], label: 'Agent Board ao vivo: o que cada IA está fazendo agora' },
    ],
  },
  {
    title: 'Código',
    entries: [
      { argv: ['fix'], label: 'Corrigir o erro que está no clipboard' },
      { argv: ['fix', '--undo'], label: 'Desfazer o último fix' },
      { argv: ['review'], label: 'Revisar as mudanças' },
      { argv: ['test'], label: 'Gerar testes', usage: 'test [arquivo]', ask: { message: 'Arquivo (vazio = os arquivos alterados):', required: false } },
      { argv: ['guard'], label: 'Procurar segredos no que está no stage' },
      { argv: ['format'], label: 'Formatar o código' },
    ],
  },
  {
    title: 'Git',
    entries: [
      { argv: ['log'], label: 'Ver o histórico de commits' },
      { argv: ['undo'], label: 'Desfazer o último commit' },
      { argv: ['branch', '--list'], label: 'Listar as branches' },
      { argv: ['branch', '--delete'], label: 'Apagar uma branch local' },
      { argv: ['release'], label: 'Nova versão (SemVer, CHANGELOG e tag)' },
    ],
  },
  {
    title: 'Documentação e conhecimento',
    entries: [
      { argv: ['doc'], label: 'Documentar uma lib npm', usage: 'doc <lib>', ask: { message: 'Nome da lib:', required: true } },
      { argv: ['doc', '--code'], label: 'Documentar o código do projeto' },
      { argv: ['knowledge'], label: 'Base de conhecimento (buscar, adicionar, ligar, ver)', submenu: 'knowledge' },
      { argv: ['learn'], label: 'Aprender com o seu feedback (atualiza o perfil)' },
    ],
  },
  {
    title: 'Configuração',
    entries: [
      { argv: ['init'], label: 'Configurar o Kvasir neste projeto' },
      { argv: ['keys'], label: 'Chaves de IA na nuvem (Gemini, Groq)', submenu: 'keys' },
      { argv: ['persona'], label: 'Personas (convenções da empresa)', submenu: 'persona' },
      { argv: ['agents'], label: 'Time de agentes (quem faz cada tarefa, trocar modelos)', submenu: 'agents' },
      { argv: ['models'], label: 'Ver os modelos e o desempenho' },
      { argv: ['doctor'], label: 'Diagnosticar o ambiente' },
    ],
  },
];

export const SUBMENUS: Record<string, CatalogGroup> = {
  keys: {
    title: 'Chaves de IA na nuvem',
    entries: [
      { argv: ['keys', 'status'], label: 'Ver o que está configurado' },
      { argv: ['keys', 'set'], label: 'Salvar uma chave', usage: 'keys set <gemini|groq>' },
      { argv: ['keys', 'remove'], label: 'Remover uma chave', usage: 'keys remove <gemini|groq>' },
      { argv: ['models', '--cloud', 'on'], label: 'Ligar o uso da nuvem' },
      { argv: ['models', '--cloud', 'off'], label: 'Desligar o uso da nuvem (só Ollama local)' },
    ],
  },
  agents: {
    title: 'Time de agentes',
    entries: [
      { argv: ['agents', 'list'], label: 'Ver o time e o desempenho de cada agente' },
      { argv: ['agents', 'set'], label: 'Trocar os modelos de um agente', usage: 'agents set <architect|reviewer|documenter|tester|executor>' },
    ],
  },
  persona: {
    title: 'Personas',
    entries: [
      { argv: ['persona', 'list'], label: 'Listar as personas' },
      { argv: ['persona', 'show'], label: 'Ver as regras de uma persona', usage: 'persona show <nome>', ask: { message: 'Nome da persona:', required: true } },
      { argv: ['persona', 'create'], label: 'Criar uma persona' },
      { argv: ['persona', 'remove'], label: 'Remover uma persona', usage: 'persona remove <nome>', ask: { message: 'Nome da persona:', required: true } },
    ],
  },
  knowledge: {
    title: 'Base de conhecimento',
    entries: [
      { argv: ['knowledge', 'search'], label: 'Buscar', usage: 'knowledge search <termo>', ask: { message: 'Buscar por:', required: true } },
      { argv: ['knowledge', 'add'], label: 'Adicionar uma nota' },
      { argv: ['knowledge', 'link'], label: 'Ligar duas notas' },
      { argv: ['knowledge', 'show'], label: 'Ver o índice e o grafo de conexões (navegador)' },
    ],
  },
};

export function allEntries(): CatalogEntry[] {
  return [...MAIN_MENU, ...Object.values(SUBMENUS)].flatMap((group) => group.entries).filter((entry) => !entry.submenu);
}
