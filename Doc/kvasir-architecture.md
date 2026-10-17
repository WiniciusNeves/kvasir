# Kvasir: arquitetura

> Como o código funciona **hoje**. Se mudar o código, atualize este arquivo.

---

## Visão geral

```
┌─────────────────────────────────────────────────────────────┐
│ src/cli/          Commander: registra comandos e flags      │
│                   (fino, sem lógica)                        │
└───────────────┬─────────────────────────────────────────────┘
                │ chama runX()
┌───────────────▼─────────────────────────────────────────────┐
│ src/modules/<x>/  Runner: orquestra o fluxo do comando      │
│                   contexto → IA → mostrar → confirm → executar│
└──┬──────────────┬──────────────┬─────────────┬──────────────┘
   │              │              │             │
┌──▼─────┐  ┌─────▼──────┐  ┌────▼─────┐  ┌────▼────────────┐
│ src/ai │  │ src/utils  │  │ adapters │  │ integrations    │
│ router │  │ git, fs,   │  │ CLAUDE.md│  │ planner (tasks) │
│ ollama │  │ prompt...  │  │ copilot  │  │                 │
│ client │  │            │  │ cursor   │  │                 │
└────────┘  └────────────┘  └──────────┘  └─────────────────┘
```

| Camada | Pasta | Responsabilidade |
|---|---|---|
| CLI | `src/cli/` | Registrar o comando, parsear flags e chamar o runner via `withErrorHandling()` |
| Runner | `src/modules/<modulo>/` | Orquestrar o fluxo: contexto → IA → mostrar → `confirm()` → executar → feedback |
| IA | `src/ai/` | Toda comunicação com modelos (router, Ollama, clipboard) |
| Utils | `src/utils/` | Helpers puros: git, fs, prompts, editor, typecheck, process (comandos sem shell), feedback, erros |
| Adapters | `src/adapters/` | Gerar o arquivo de instruções de cada IA a partir do `kvasir.context.md` |
| Personas | `src/personas/` | Regras de cada empresa/time (ACME) e templates de `CLAUDE.md` |
| Integrations | `src/integrations/` | APIs externas (Planner) |
| Types | `src/types/` | Todos os tipos, importados via `@ktypes/*` |

---

## Estrutura de pastas

```
kvasir/
├── src/
│   ├── cli/                 # um arquivo por comando + index.ts (registra todos)
│   │   ├── index.ts
│   │   ├── init.ts  branch.ts  commit.ts  fix.ts  format.ts  doc.ts
│   │   ├── task.ts  review.ts  knowledge.ts  start.ts  learn.ts
│   │   └── undo.ts  push.ts  log.ts  models.ts
│   ├── modules/
│   │   ├── init/            # index.ts, detector.ts, personaLoader.ts, contextWriter.ts
│   │   ├── doc/             # index.ts (libs npm), code.ts (código do projeto)
│   │   └── branch/ commit/ fix/ format/ knowledge/ learn/ log/
│   │       models/ push/ review/ start/ task/ undo/   (index.ts cada)
│   ├── ai/
│   │   ├── router.ts        # askFor(task, prompt): orquestra modelo + validação
│   │   ├── ollama.ts        # askOllama(), listInstalledModels()
│   │   └── client.ts        # promptAI(): ponte via clipboard com o Claude
│   ├── adapters/            # claude.ts, copilot.ts, cursor.ts
│   ├── personas/
│   │   ├── acme.ts
│   │   └── templates/       # acme-mobile.md, acme-web.md (copiados para dist/ no build)
│   ├── integrations/planner.ts
│   ├── utils/               # git, fs, prompt, editor, typecheck, feedback, errors
│   └── types/               # context, persona, feedback, knowledge, task
├── Doc/                     # documentação do projeto
├── dist/                    # build (não versionado)
├── CLAUDE.md                # regras para a IA que trabalha NESTE repositório
└── package.json             # bin: kvasir → dist/cli/index.js
```

Path aliases (`tsconfig.json`): `@cli/*`, `@modules/*`, `@adapters/*`, `@ai/*`, `@utils/*`, `@ktypes/*`, `@integrations/*`.
Resolvidos no build por `tsc-alias` e no dev por `tsconfig-paths`.

---

## Camada de IA

Existem **três formas** de chamar IA, todas em `src/ai/`:

| Função | Arquivo | Quando usar |
|---|---|---|
| `askFor(task, prompt, opts?)` | `router.ts` | **Padrão.** Qualquer tarefa com um tipo definido em `AiTask` |
| `askLocal(task, prompt, opts?)` | `router.ts` | Lote / rápido: primeiro modelo instalado de `MODEL_MAP[task]`, com fallback, sem clipboard (`doc --code`, expansão do `fix`) |
| `askOllama(prompt, opts?)` | `ollama.ts` | Chamada crua ao Ollama (usada pelo router; `num_ctx` 8192, remove `<think>`) |
| `promptAI(prompt)` | `client.ts` | Só o Claude, via clipboard (usada no `learn`) |

### Como o `askFor` funciona

```
askFor('fix', prompt)
   │
   ├─ 1. lê kvasir.context.md (arquitetura do projeto)
   │
   ├─ 2. ORQUESTRADOR: promptAI() copia para o clipboard um prompt pedindo
   │     "MODELO: <nome>". Você cola no Claude, copia a resposta e aperta Enter
   │     (o kvasir lê a resposta do clipboard: funciona com várias linhas).
   │
   ├─ 3. ordena os modelos: [escolhido, ...resto de MODEL_MAP[task]]
   │
   ├─ 4. EXECUTOR: askOllama(prompt, { model, timeout 120s, temperature? })
   │     (os modelos vêm de MODEL_MAP filtrados pelos instalados: "qwen2.5-coder"
   │      casa com "qwen2.5-coder:7b"; Ollama fora do ar → erro com dica)
   │     se falhar → tenta o próximo modelo da lista
   │
   └─ 5. VALIDADOR: promptAI() manda o resultado ao Claude para validar
         ou corrigir. A resposta colada é o retorno final.
```

`MODEL_MAP` (em `router.ts`):

| Tarefa (`AiTask`) | Modelos (ordem de fallback) |
|---|---|
| `commit` | qwen2.5-coder → codellama |
| `branch` | qwen2.5-coder → codellama |
| `fix` | qwen2.5-coder → deepseek-r1 → codellama |
| `review` | qwen2.5-coder → deepseek-r1 → codellama |
| `doc` | llama3.2 → qwen2.5-coder |
| `architect` | deepseek-r1 → llama3.2 |

> ⚠️ Cada `askFor` exige **duas** idas e vindas pelo clipboard (escolher o modelo e validar). Ver "Problemas conhecidos" em `kvasir-current.md`.

---

## Dados e arquivos

### Por projeto (gerado por `kvasir init`)

| Arquivo | Gerado por | Conteúdo |
|---|---|---|
| `kvasir.context.md` | `contextWriter.ts` | **Fonte da verdade:** projeto, persona, regras de branch/commit, módulos e task ativa |
| `CLAUDE.md` | `adapters/claude.ts` | Cabeçalho automático entre `<!-- kvasir:header:start/end -->` + corpo do template da stack. Nas próximas execuções **só o cabeçalho é atualizado** |
| `.github/copilot-instructions.md` | `adapters/copilot.ts` | Regras resumidas para o Copilot |
| `.cursor/rules` | `adapters/cursor.ts` | Regras resumidas para o Cursor |
| `DOC/libs/<lib>.md` | `kvasir doc` | Resumo da lib em português |
| `DOC/code/<caminho>.md` | `kvasir doc --code` | Documentação de cada arquivo |

### Global (`~/.kvasir/`)

```
~/.kvasir/
├── profile.md              # perfil do dev (atualizado pelo kvasir learn)
├── backups/fix/            # backups do último kvasir fix + last-fix.json (usado pelo --undo)
├── personas/acme.json       # salvo na 1ª vez a partir de src/personas/acme.ts
├── feedback/
│   ├── commits.md          # aprovações/rejeições do commit
│   ├── fixes.md            # aprovações/rejeições do fix
│   └── patterns.md         # aprovações/rejeições do review
└── knowledge/
    ├── index.md            # (opcional) mostrado pelo knowledge show
    ├── libs/               # gerado pelo kvasir doc, com links [[projeto]]
    └── patterns/ decisions/ tasks/ commits/   # notas manuais (knowledge add)
```

---

## Fluxo de cada comando

### `kvasir init`
1. Lê o `package.json`. Se o `name` **contém** `acme`, o projeto é ACME. Senão, pergunta se quer usar a persona ACME ou pular.
2. Detecta a stack pelas deps: `next` → Next.js · `expo` → React Native + Expo · `express`/`fastify` → Node.js API · sempre TypeScript.
3. Carrega a persona de `~/.kvasir/personas/<nome>.json` (ou a built-in, que salva lá).
4. Pede `confirm()` e então escreve `kvasir.context.md` e roda os 3 adapters.
5. `CLAUDE.md` usa o template `acme-mobile.md` (se tem `expo`) ou `acme-web.md` (se tem `next`), ou um corpo gerado (scripts, árvore de pastas, regras).

### `kvasir commit`
1. Lê `git diff --cached`. Se estiver vazio, oferece `git add -A`.
2. `askFor('commit', temperature 0.2)` com `--stat` + diff cortado em 12k caracteres → `pickLine` pega a linha no padrão Conventional Commits; avisa se não seguir o padrão ou passar de 72 caracteres.
3. Pergunta: Sim / Não / Editar (abre o editor). Registra o feedback em `commits.md`.
4. `git commit -m`.
5. Menu em loop: push (com cancelar) · undo (encerra o menu) · log · merge (pede confirmação e oferece voltar à branch) · sair. Uma ação git que falha mostra o erro e volta ao menu.

### `kvasir branch`
1. Pergunta a descrição da tarefa → `askFor('branch', temperature 0.2)` (o prompt pede tradução para inglês e kebab-case) → `parseBranchName` acha `prefixo/…` na resposta, remove rótulos e acentos e garante um prefixo válido (padrão `feature/`).
2. Sim / Não / Editar → `git checkout -b`.
3. Menu em loop: deletar outra branch · listar · voltar para a anterior · sair.
- `-l` lista locais e remotas · `-d` deleta (pergunta se força `-D` quando não está mergeada).

### `kvasir fix`
```
de onde vem o erro? clipboard (padrão) · rodar o typecheck · digitar 1 linha
   │
   ├─ parseTscDiagnostics (utils/typecheck): entende "arq.ts(12,5): error TSxxxx" e
   │  "arq.ts:12:5 - error TSxxxx", com caminho absoluto do Windows e cores ANSI
   │    nenhum diagnóstico → askFor('fix') sugere (só mostra; "foi útil?")
   │
   ├─ alvo = arquivo do 1º erro colado; corrige cada erro colado nesse arquivo,
   │  SEM PERGUNTAR (decisão do usuário, ver kvasir-decisions.md):
   │    1. regra determinística (TS6137: '@types/X' → 'X', pela mensagem do tsc)
   │    2. senão askFor('fix'): prompt com a mensagem, trecho numerado (±15 linhas,
   │       linha marcada com >>) e a linha atual; pede SÓ a linha em ```ts
   │       parseCorrectedLine: tira <think>, cercas, rótulos, eco do trecho e prosa;
   │       mantém a indentação; descarta se for igual à original
   │    backup em ~/.kvasir/backups/fix/<ts>-<nome>.kvasir-original.<ext>
   │    preserva CRLF/LF → mostra ANTES/DEPOIS → abre diff lado a lado no VS Code
   │    nada corrigido → oferece investigação com askFor('architect') (só mostra)
   │
   ├─ roda o typecheck (tsc local via node, --pretty false) e conta os erros
   │  com o mesmo código: "Encontrei mais N erro(s) TSxxxx em M arquivo(s)"
   │    confirm("Corrigir os outros também?") → regra determinística ou
   │    askLocal('fix') (modelo local direto, sem clipboard) → typecheck final
   │
   └─ "kvasir fix --undo" restaura todos os arquivos do último fix (last-fix.json)
```

### `kvasir doc <lib>`
npm registry → (sem README? tenta `raw.githubusercontent.com` em `main`/`master`) → `askFor('doc', maxTokens 2048)` → confirm → salva em `DOC/libs/` e `~/.kvasir/knowledge/libs/` (com a linha `Usado em: [[projeto]]`, juntando projetos).

### `kvasir doc --code`
- `--code <arquivo|pasta>`: documenta o arquivo, ou cada arquivo da pasta com confirmação.
- `--code`: menu de pastas da raiz (com contagem) → checkbox de arquivos, ou "arquivo específico" / "projeto inteiro".
- `--code --all [--force]`: projeto inteiro com progresso, pulando o que já tem doc (a menos que use `--force`).
- Usa `askLocal('doc')` (llama3.2 → qwen2.5-coder, sem clipboard), passa a lista de exports extraída por regex para o modelo não inventar nomes, e ignora `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage` e `DOC`.

### `kvasir review`
1. `runReviewChecks` (`review/checks.ts`) varre só as linhas adicionadas do diff, com número de linha: credencial no código, `for (… <= x.length)`, `any`, `console.log`, `debugger`. Mostra como "Checagens automáticas".
2. `askFor('review', temperature 0.2, repeatPenalty 1.2, maxTokens 700)`: diff (até 12k) + `--stat` + o que as checagens já acharam ("não repita"); pede lista `[bug|segurança|estilo|melhoria] arquivo — problema — sugestão` ou "Nenhum problema encontrado.".
3. `normalizeFindings` mantém só os itens da lista, sem duplicados, no máximo 10 (modelos locais repetem itens).
4. "As sugestões foram úteis?" → `patterns.md`. Não aplica nada.

### `kvasir models`
Lista os modelos instalados no Ollama, o status de cada modelo do `MODEL_MAP` e o primeiro instalado por tarefa.

### `kvasir learn`
Últimos 150 registros de feedback dos 3 arquivos + `profile.md` atual → prompt em português → `promptAI` → `extractProfile` (tira frase introdutória e cercas ```, começa no `# `) → mostra → confirm → salva `~/.kvasir/profile.md`.

### `kvasir knowledge`
- `add`: categoria + título + conteúdo (digitado em 1 linha ou lido do clipboard, várias linhas). Nome do arquivo = título sem acentos, só `[a-z0-9-]` (títulos com `/` ou `:` criavam subpasta / stream NTFS). Se a nota existe, pergunta antes de substituir.
- `search <termo>`: nome e conteúdo; mostra a linha encontrada.
- `link`: acrescenta `Relacionado: [[nota]]` nas duas notas, sem duplicar.
- `show`: `index.md` ou a lista de notas.

### `kvasir task` / `kvasir start`
- `fetchMyTasks()` (`integrations/planner.ts`): lê `KVASIR_PLANNER_API_URL` / `_TOKEN` na hora da chamada, GET com timeout de 10s, valida a resposta com **zod** (lista de `{ id, title, status }`, `id` numérico vira string). Erros viram mensagens em português (token recusado, sem conexão, formato inesperado).
- `task`: mostra a task ativa, deixa escolher outra e, com confirmação, grava em `## Active task` do `kvasir.context.md` via `setActiveTask` (reescreve só essa seção). Sem URL configurada, explica o que configurar.
- `start`: projeto, persona, task ativa, branch e tasks do Planner. Falha do Planner mostra o erro e **não** interrompe o resumo.
- `branch` usa a task ativa: a descrição já vem preenchida com o título e, se usada, a branch criada é gravada em `linked branch`.

### `kvasir push` / `undo` / `log` / `format`
- `push`: normal, `--force-with-lease` ou cancelar
- `undo`: `git reset HEAD~1 --soft` com confirmação
- `log`: os últimos 10 commits numa tabela ASCII
- `format`: `npm run format` se existir, senão `npx prettier --write .`, via `runCommand` (sem shell)

---
## Regras transversais

- **Nada executa sem `confirm()`**: git, escrita de arquivo, formatter. Exceção: o `kvasir fix` aplica a correção do erro colado direto (com backup e `--undo`).
- **Git sempre via `spawnSync` com array de argumentos** e conferindo o `status`; outros comandos via `runCommand` (nunca `shell: true`).
- **Erros:** os comandos são envolvidos por `withErrorHandling()`, que imprime `✖ mensagem` em vermelho.
- **Ctrl+C:** `SIGINT` encerra com "👋 Kvasir encerrado."
- **Idioma:** interface em português; commits, branches e código em inglês.
