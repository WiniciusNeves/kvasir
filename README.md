# Kvasir

> Um ecossistema de produtividade para desenvolvedores que roda no terminal, conhece o seu projeto e usa IA local para automatizar o trabalho repetitivo do dia a dia.

Kvasir é uma CLI em **Node.js + TypeScript**. Você roda `kvasir commit` e ele lê o diff e sugere a mensagem no padrão certo. Você roda `kvasir fix`, cola o erro e ele encontra o arquivo, propõe a correção, abre o diff no VS Code e roda o typecheck para confirmar. Tudo com **IA rodando na sua máquina (Ollama)** e **nada é executado sem a sua aprovação**.

O nome vem da mitologia nórdica: Kvasir era o ser mais sábio entre os deuses, capaz de responder qualquer pergunta.

---

## Por que existe

- **Trabalho repetitivo:** escrever mensagem de commit, nomear branch, documentar lib e corrigir erro de tipagem tomam tempo todos os dias.
- **Contexto perdido:** cada IA (Claude, Copilot, Cursor) precisa ser reexplicada sobre o projeto. O Kvasir gera esse contexto **uma vez** e alimenta todas.
- **Privacidade e custo:** o executor é o Ollama local. O código não sai do seu PC e não há custo por token.

---

## Como funciona (visão rápida)

```
você roda um comando (kvasir commit, fix, doc...)
        │
        ▼
Kvasir monta o contexto ── kvasir.context.md (projeto, persona, regras)
        │
        ▼
AI Router (src/ai/router.ts)
  1. Claude (via clipboard) escolhe o melhor modelo local para a tarefa
  2. Ollama executa (com fallback entre modelos)
  3. Claude (via clipboard) valida o resultado
        │
        ▼
Kvasir mostra o resultado ──► você aprova / edita / rejeita
        │
        ▼
executa (git, arquivo...) e registra o feedback em ~/.kvasir/feedback/
```

Detalhes em [`Doc/kvasir-architecture.md`](Doc/kvasir-architecture.md).

---

## Comandos

**Não lembra o comando?** Não precisa:

- `kvasir` sozinho abre um menu com tudo, em português. `kvasir keys`, `kvasir persona` e `kvasir knowledge` sozinhos abrem o menu deles.
- Escreva o que quer: `kvasir quero salvar minha chave do groq` → "Entendi: kvasir keys set groq. Rodar agora?". A IA só escolhe entre os comandos que existem, e nada roda sem você confirmar.
- Digitou errado (`kvasir comit`)? Ele pergunta se você quis dizer `kvasir commit`.
- Se um comando precisa de outro antes, ele oferece rodar na hora: sem `kvasir.context.md` oferece o `init`; depois de escolher a task oferece criar a branch; `models --cloud on` sem chave oferece o `keys set`.

| Comando | O que faz | Status |
|---|---|---|
| `kvasir init` | Detecta o projeto (deps do `package.json`), deixa escolher a persona e gera `kvasir.context.md`, `CLAUDE.md`, `.github/copilot-instructions.md` e `.cursor/rules` | ✅ |
| `kvasir persona list \| show \| create \| remove` | Personas = convenções de uma empresa (prefixos e idioma de branch, idioma de commit, padrão de repositório). Vem só a `default` (neutra); a persona da sua empresa fica no seu `~/.kvasir/personas/` (pessoal, fora do git) | ✅ |
| `kvasir commit` | Roda o `guard`, lê o diff staged e sugere uma mensagem Conventional Commits em inglês; depois mostra um menu (push, undo, log, merge). `--no-guard` pula a checagem | ✅ |
| `kvasir guard` | Procura segredos (chaves AWS/Google/GitHub/Stripe, JWT, senhas), arquivos proibidos (`.env`, chaves, Firebase) e dados pessoais (cartão, CPF, CNPJ) no stage; strings aleatórias suspeitas vão para a IA. Exceções em `.kvasirignore` | ✅ |
| `kvasir branch` | Descreve a tarefa e ele gera o nome da branch no Git Flow. `-l` lista, `-d` deleta | ✅ |
| `kvasir doc <lib>` | Busca o README no npm/GitHub, resume em português e salva em `DOC/libs/` e `~/.kvasir/knowledge/libs/` | ✅ |
| `kvasir doc --code [caminho]` | Documenta o código do projeto em `DOC/code/` (`--all` = projeto inteiro, `--force` = refaz) | ✅ |
| `kvasir pr` | Título e descrição do Pull Request em português (o que mudou, como testar, prints se mexeu em tela, checklist, task, commits) a partir dos commits e do diff contra a base do Git Flow; copia ou cria com `gh pr create` | ✅ |
| `kvasir daily` | Resume seus commits (todas as branches, de ontem ou de sexta na segunda) em "Ontem / Hoje / Impedimentos" em português e copia para colar no chat do time. `--repos <pasta>`, `--since <data>` | ✅ |
| `kvasir release` | Calcula a próxima versão SemVer pelos Conventional Commits, atualiza `CHANGELOG.md`, `package.json`/`package-lock.json`/`app.json` (Expo), commita `chore(release): vX.Y.Z` e cria a tag; notas de release em português com IA (opcional) | ✅ |
| `kvasir test [arquivo]` | Gera testes (vitest/jest, no estilo dos testes do projeto) para os arquivos alterados, roda e corrige sozinho até 3 vezes; se o teste revelar um bug real no código, avisa em vez de "consertar" o teste | ✅ |
| `kvasir doctor` | Diagnóstico do ambiente com ✅/⚠️/❌ e como corrigir: Node × `engines`, Git, JDK/Android/Expo/EAS (projetos mobile), Ollama e modelos (oferece baixar os que faltam), `~/.kvasir`, VS Code, `gh` | ✅ |
| `kvasir keys` / `keys set` / `keys remove` | Salva a chave do Gemini ou do Groq com um comando: você cola (fica oculta), ele testa na API e grava como variável de ambiente do seu usuário. Nunca vai para o git nem para o `~/.kvasir` | ✅ |
| `kvasir agents` / `agents set` | Time de agentes: Arquiteto, Revisor, Documentador, Testador e Executor, cada tarefa com um único dono. Mostra quem faz o quê e o desempenho; `set` troca os modelos de um agente ou o deixa só no Ollama local | ✅ |
| `kvasir models` | Mostra modelos locais e na nuvem, quem responde cada tarefa e o desempenho real (tempo, tokens, aprovação). `--cloud on\|off` liga/desliga Gemini e Groq | ✅ |
| `kvasir fix` | Copie o erro e rode: ele corrige o arquivo do erro (regra determinística ou IA), abre o diff lado a lado no VS Code, conta os erros iguais no projeto e pergunta se corrige os outros. `kvasir fix --undo` desfaz | ✅ |
| `kvasir review` | Revisa as linhas adicionadas do diff staged, uma por uma, e aponta `arquivo:linha` | ✅ |
| `kvasir push` / `undo` / `log` | Push (normal ou `--force-with-lease`), desfaz o último commit (soft) e mostra o histórico em tabela | 🧪 |
| `kvasir format` | Roda `npm run format` ou o Prettier | 🧪 |
| `kvasir knowledge search\|add\|link\|show` | Base de conhecimento estilo Obsidian em `~/.kvasir/knowledge/`, com notas geradas sozinhas pelos outros comandos. `show` abre o grafo de conexões no navegador | ✅ |
| `kvasir stats` | Painel no navegador: chamadas, aprovação, tempo, tokens, radar de uso, barras por dia, modelos, o que o Kvasir aprendeu e o Agent Board. Offline, gerado em `~/.kvasir/reports/` | ✅ |
| `kvasir watch` | Corrige erros sozinho, do TypeScript e de execução (exceções e testes que falham): vigia o clipboard ou roda o seu comando (`kvasir watch -- npm run dev`, `kvasir watch -- npx vitest`). Cada correção é validada (não aceita `any`/`@ts-ignore`/`catch` vazio nem mudar o teste, não pode criar erro novo, roda o teste de novo) e desfeita se não passar ou se o erro voltar. Nunca faz commit nem push; `kvasir fix --undo` desfaz | ✅ |
| `kvasir index` / `kvasir ask "pergunta"` | Busca local no seu código, no `Doc/` e nas suas anotações: `ask` responde citando `arquivo:linha` e mostra as fontes. Tudo no seu PC (Ollama), sem instalar banco nenhum; `.env`, chaves e o que está no `.gitignore` ficam de fora. Resposta que ajudou vira nota no knowledge (Obsidian, grafo e `stats`) e é reaproveitada. Com o projeto indexado, `fix`, `watch`, `review` e `test` também usam esse contexto e erram menos; `kvasir index --watch` mantém o índice atualizado | ✅ |
| `kvasir docs update` | Mantém o README e a pasta de documentação em dia: vê o que mudou no código desde a última vez que a documentação foi commitada (função renomeada, função nova, script novo…), propõe a mudança de cada documento e mostra o diff para você aprovar | ✅ |
| `kvasir proactive` | Sugestões do Kvasir no momento certo (criar a branch da task, revisar antes de um commit grande, documentar lib nova, apagar branch parada). Começam perguntando; o que você sempre aceita vira automático, o que sempre recusa para | ✅ |
| `kvasir board` | Agent Board ao vivo: o que cada agente tem a fazer, está fazendo, fez e falhou (atualiza a cada 3 s) | ✅ |
| `kvasir learn` | Consolida o feedback e atualiza `~/.kvasir/profile.md` (usado nos prompts) | ✅ |
| `kvasir task` / `start` | Busca tasks (Planner/API), grava a task ativa e mostra o resumo do dia | ✅ |

✅ funcionando · 🔧 em desenvolvimento · 🧪 implementado, falta testar

---

## Instalação

**Requisitos**

- Node.js >= 22.13
- Git
- [Ollama](https://ollama.com) rodando em `http://localhost:11434`
- VS Code (o `kvasir fix` abre o diff com o comando `code`)

**Opcional: IA na nuvem (grátis)**

Com uma chave, textos em português vão para o Gemini Flash e tarefas de código para o Groq; se o limite grátis acabar ou não houver internet, o Kvasir volta para o Ollama sozinho. Sem chave, tudo roda local.

```bash
kvasir keys set gemini
```

```bash
kvasir keys set groq
```

O comando mostra onde criar a chave grátis, pede para colar (sem mostrar na tela), testa na API e salva. Funciona na hora, sem reabrir o terminal. `kvasir keys` mostra o que está configurado e `kvasir keys remove` apaga.

- A chave fica só na variável de ambiente do seu usuário (Windows: variáveis de ambiente do usuário; macOS/Linux: um bloco marcado no `~/.zshrc`/`~/.bashrc`): nunca no código nem no `~/.kvasir/config.json` (o `kvasir guard` bloqueia commit de chave do Google, nos formatos `AIza` e `AQ.`, e do Groq, `gsk_`).
- Na primeira vez, o Kvasir pergunta se pode enviar prompts (que podem conter código) para a nuvem. Mude depois com `kvasir models --cloud on|off`.
- O `guard` nunca usa a nuvem e o modelo de arquitetura continua local.
- Para não ter custo: não ative o faturamento no projeto do Google e não cadastre cartão no Groq (confira os planos nos painéis deles).

**Modelos usados pelo router**

```bash
ollama pull codellama
ollama pull qwen2.5-coder
ollama pull llama3.2
ollama pull deepseek-r1
```

**Instalar o Kvasir**

```bash
git clone https://github.com/WiniciusNeves/kvasir.git
cd kvasir
npm install
npm run build
npm link        # deixa o comando "kvasir" disponível em qualquer pasta
```

**Usar num projeto**

```bash
cd meu-projeto
kvasir init     # obrigatório antes dos outros comandos
kvasir models   # confere se os modelos estão instalados
```

**Variáveis de ambiente (opcional)**

| Variável | Uso |
|---|---|
| `KVASIR_PLANNER_API_URL` | Endpoint de tasks usado por `kvasir task` e `kvasir start` |
| `KVASIR_PLANNER_API_TOKEN` | Token Bearer desse endpoint |

---

## Desenvolvimento

```bash
npm run dev -- commit   # roda sem build (ts-node)
npm run typecheck       # checa os tipos
npm run build           # compila para dist/
```

As regras de código e o padrão de módulos estão no [`CLAUDE.md`](CLAUDE.md).

---

## Onde quero chegar

Hoje o Kvasir é uma CLI. O objetivo é virar um **assistente de desenvolvimento pessoal, local e open source**: ele entende português informal, tem memória do seu código (RAG local), trabalha com um time de agentes especializados e chega também a um app desktop com voz.

Visão completa: [`Doc/kvasir-vision.md`](Doc/kvasir-vision.md)

---

## Contribuindo

Contribuições são bem-vindas: veja o [`CONTRIBUTING.md`](CONTRIBUTING.md) (como rodar, regras e padrão de commits) e o [Código de Conduta](CODE_OF_CONDUCT.md). Falha de segurança: [`SECURITY.md`](SECURITY.md) (reporte privado, nunca issue pública). Todo PR passa pelo CI (typecheck e build em Linux, Windows e macOS).

## Licença

[MIT](LICENSE) © WiniciusNeves. Use, modifique e distribua à vontade, mantendo o aviso de copyright.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`Doc/kvasir-architecture.md`](Doc/kvasir-architecture.md) | Como o código funciona: camadas, AI router, fluxo de cada comando |
| [`Doc/kvasir-current.md`](Doc/kvasir-current.md) | Estado atual: o que funciona, o que falta testar, problemas conhecidos |
| [`Doc/kvasir-roadmap.md`](Doc/kvasir-roadmap.md) | O que vem a seguir, em ordem |
| [`Doc/kvasir-decisions.md`](Doc/kvasir-decisions.md) | Por que cada decisão técnica foi tomada |
| [`Doc/kvasir-vision.md`](Doc/kvasir-vision.md) | Onde o projeto quer chegar |
| [`Doc/ideas/`](Doc/ideas/) | Especificação de módulos futuros |
