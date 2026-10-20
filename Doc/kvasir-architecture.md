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
| Personas | `src/personas/` | Só a persona `default` (neutra); as de empresa e seus templates ficam em `~/.kvasir` |
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
│   │       knowledge/notes.ts (escrita no vault) + auto.ts (notas automáticas)
│   ├── ai/
│   │   ├── router.ts        # askFor / askLocal: modelos instalados, fallback, preferências do profile.md
│   │   ├── ollama.ts        # askOllama(), listInstalledModels()
│   │   ├── client.ts        # promptAI(): ponte via clipboard com o Claude
│   │   ├── metrics.ts       # recordAiCall / recordOutcome / summarizeMetrics
│   │   └── parse.ts         # parse defensivo das respostas
│   ├── adapters/            # claude.ts, copilot.ts, cursor.ts
│   ├── personas/
│   │   └── default.ts       # única persona embutida (neutra)
│   ├── integrations/planner.ts
│   ├── utils/               # git, fs, prompt, editor, typecheck, process, diff, imports, feedback, errors
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
| `askLocal(task, prompt, opts?)` | `router.ts` | Sem as idas ao Claude: nuvem da tarefa (se permitida) e depois a cadeia local, com fallback |
| `askOllama(prompt, opts?)` | `ollama.ts` | Chamada crua ao Ollama (usada pelo router; `num_ctx` 8192, remove `<think>`) |
| `promptAI(prompt)` | `client.ts` | Só o Claude, via clipboard (usada no `learn`) |

### Candidatos: nuvem (opcional) → Ollama
`resolveCandidates(task)` monta a ordem: provedores de `CLOUD_MAP[task]` com chave no ambiente e consentimento → modelos de `MODEL_MAP[task]` instalados no Ollama. Ollama fora do ar só é fatal se não houver nuvem.

| Tarefa | Nuvem (antes) | Local (depois) |
|---|---|---|
| doc, daily, release | Gemini Flash | llama3.2 / qwen2.5-coder |
| pr | Gemini → Groq | qwen2.5-coder / llama3.2 |
| commit, branch, fix, review, test | Groq | qwen2.5-coder / codellama / deepseek-r1 |
| architect | — (fica no deepseek-r1) | deepseek-r1 / llama3.2 |
| guard | — (nunca sai da máquina) | qwen2.5-coder / llama3.2 |

- Chaves: `GEMINI_API_KEY` / `GROQ_API_KEY` (ou `KVASIR_*`), lidas do ambiente do processo e, se faltarem, do valor salvo por `kvasir keys` (`utils/userEnv.ts`: registro `HKCU\Environment` no Windows, bloco marcado no perfil do shell no macOS/Linux), para funcionar sem reabrir o terminal. Modelos: `ai.geminiModel` (padrão `gemini-flash-latest`) e `ai.groqModel` (padrão `qwen/qwen3.8-27b`; o catálogo do Groq muda, um 404 avisa para trocar) em `~/.kvasir/config.json`. `KVASIR_GEMINI_BASE_URL`/`KVASIR_GROQ_BASE_URL` servem para proxy ou mock.
- Consentimento: `ai.cloud` no `config.json`; perguntado uma vez quando há chave; `kvasir models --cloud on|off`.
- Falha (429, chave recusada, 5xx, timeout, sem rede) → próximo candidato; a mensagem nunca inclui a chave.

### Time de agentes (`agents.ts`)
Cada `AiTask` tem um único dono (`TASK_OWNER`, um `Record`: tarefa nova sem dono não compila):

| Agente | Tarefas | Papel |
|---|---|---|
| Arquiteto | architect | causa raiz, decisões técnicas |
| Revisor | review, fix, guard | avalia e corrige código, segredos |
| Documentador | doc, pr, daily, release | textos para pessoas |
| Testador | test | gera e revisa testes |
| Executor | commit, branch, intent | tarefas curtas e exatas |

- **Contexto isolado:** `buildAgentPrompt` = prompt de papel do dono + preferências do `profile.md` (onde se aplicam) + prompt da tarefa. Nada de outro agente entra.
- **Dono único:** o router só usa os modelos do dono; no `askFor` o Claude é avisado de quem é a tarefa e escolhe entre os modelos desse agente.
- **Substituível sem mexer em módulos:** `~/.kvasir/config.json` → `agents.<nome>.models` (cadeia local de todas as tarefas do agente) e `agents.<nome>.cloud: false`. `CLOUD_MAP` vazio (guard, architect) continua mandando: nenhuma configuração liga a nuvem ali. `kvasir agents set` edita isso.
- Métricas: cada chamada grava `agent`. `kvasir agents` mostra o time, os modelos, a nuvem e chamadas/aprovação de 30 dias; `kvasir learn` escreve `knowledge/agents/<agente>.md`.

### Escolha pelo desempenho (`performance.ts`)
`rankedCandidates(task)` pega a ordem padrão acima e aplica `rankCandidates` com as métricas dos últimos 30 dias (só da mesma tarefa):
- **Pausa:** as 3 últimas chamadas de um candidato falharam e a última foi há menos de 15 min → vai para o fim (continua como último recurso).
- **Qualidade:** quem tem dados suficientes (≥ 3 avaliações ou ≥ 5 chamadas) ganha nota = aprovação × taxa de sucesso, as duas suavizadas (Laplace); empate (< 0,05) → o mais rápido. Só os candidatos com nota trocam de lugar entre si; os sem dados ficam na posição padrão.
- Quando o primeiro vem da nota, o router avisa ("📈 X responde primeiro…"). No `askFor`, o Claude recebe a lista já ordenada com o motivo de cada um.
- `kvasir models` mostra a mesma ordem e o "por quê". O `Entendi:` da frase livre registra aprovação/rejeição da tarefa `intent`.

### Métricas e preferências (`metrics.ts`, `router.ts`)
- Toda chamada passa por `recordAiCall`: Ollama (executor, com `prompt_eval_count`/`eval_count`) e Claude via clipboard (orquestrador/validador/direto, com tamanho do prompt e tempo de ida e volta). Arquivo: `~/.kvasir/metrics/calls.jsonl`.
- Onde o usuário aprova ou rejeita um resultado (commit, branch, review, fix, doc), o módulo chama `recordOutcome(task, decision)`, que liga o veredito à última chamada executora daquela tarefa.
- `kvasir models` mostra chamadas, falhas, tempo, tokens e aprovação por tarefa × modelo, mais o custo das idas ao Claude.
- `withDeveloperPreferences`: o router coloca a seção "Preferências aprendidas" do `profile.md` no início do prompt de commit, branch, review e doc (nunca no fix/architect).

### Como o `askFor` funciona

```
askFor('fix', prompt)
   │
   ├─ 1. ordena os candidatos pelo desempenho medido (performance.ts): nuvem permitida + MODEL_MAP
   │     (sem ida ao Claude para escolher: até 2026-10-19 havia um passo "ORQUESTRADOR" aqui)
   │
   ├─ 2. EXECUTOR: candidato escolhido (nuvem: timeout 60s · Ollama: 120s), depois os outros
   │     (os modelos vêm de MODEL_MAP filtrados pelos instalados: "qwen2.5-coder"
   │      casa com "qwen2.5-coder:7b"; Ollama fora do ar → erro com dica)
   │     se falhar → tenta o próximo modelo da lista
   │
   └─ 3. VALIDADOR (ai.claudeValidation = auto): só se o modelo que respondeu ainda não provou que
         acerta nesta tarefa (5+ avaliações com 80%+ de aprovação). Aí promptAI() manda o resultado ao
         Claude (clipboard: você cola no Claude, copia a resposta e aperta Enter) e a resposta colada é
         o retorno final. Modelo confiável → o resultado volta direto. "always" / "never" forçam.
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

> Um `askFor` custa no máximo **uma** ida ao clipboard (a validação), e nenhuma quando o modelo já provou que acerta.

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
├── personas/<nome>.json    # personas (as de empresa são pessoais; a default é salva aqui no 1º uso)
├── templates/<persona>-mobile.md / -web.md  # templates de CLAUDE.md da empresa (opcionais, pessoais)
├── feedback/
│   ├── commits.md          # aprovações/rejeições do commit
│   ├── fixes.md            # aprovações/rejeições do fix
│   └── patterns.md         # aprovações/rejeições do review
├── config.json             # config do usuário: daily.repos, ai.cloud, ai.geminiModel, ai.groqModel (NUNCA chaves)
├── metrics/calls.jsonl     # cada chamada de IA (tarefa, modelo, papel, tempo, tokens) + veredito do usuário
└── knowledge/              # vault do Obsidian; toda nota tem frontmatter (title, tags, projetos, origem, criado, atualizado)
    ├── index.md            # GERADO a cada escrita (mapa por pasta, mais recentes primeiro)
    ├── libs/               # kvasir doc <lib> (com "Usado em: [[projeto]]")
    ├── errors/<código>.md  # kvasir fix: cada ocorrência (antes/depois), expansões, investigações úteis
    ├── commits/<projeto>.md# kvasir commit: data · hash · branch · mensagem
    ├── tasks/<id>.md       # kvasir task (ativação) e kvasir branch (branch vinculada)
    ├── patterns/           # review-<projeto>.md (reviews marcados como úteis) + notas manuais
    ├── agents/<modelo>.md  # kvasir learn: desempenho de cada modelo, a partir das métricas
    └── decisions/          # notas manuais (knowledge add)
```

---

## OmniContext (`src/rag/`)
Módulo isolado (alias `@rag/*`), pode virar pacote próprio. `files.ts` escolhe os arquivos (git ls-files, extensões de texto, regras do `guard` para arquivos e linhas com segredo) → `chunker.ts` (declarações / títulos / janelas) → `@ai/embeddings` (Ollama `/api/embed`, lotes de 32, `nomic-embed-text`) → `store.ts` (`VectorStore`; `FileStore`: int8 normalizado em `vectors.bin` + `chunks.json` + `meta.json` com hash por arquivo e o modelo) → `index.ts`: `indexFolder` (incremental), `search` (vetor + `keyword.ts` BM25, fusão RRF, `balance` código × docs). Runner: `modules/omnicontext` (`runIndex`, `runAsk` com reescrita da pergunta e checagem de citações). O `ask` atualiza os índices do projeto e do knowledge antes de buscar; resposta aprovada → `noteAnswer` (`knowledge/answers/`, com `[[links]]` para as notas usadas), que entra no índice na pergunta seguinte. `context.ts` (`relatedContext`) dá trechos de código relacionados para os prompts de `fix`, `watch` (tipo e runtime), `review` e `test`, com reindexação incremental a cada 30 s no máximo; `kvasir index --watch` reindexa por `fs.watch` recursivo com debounce.

## Fluxo de cada comando

### Entrada: menu, erro de digitação e linguagem natural (`modules/menu/`)
`cli/index.ts` chama `resolveCommandLine(args, comandos)` antes do commander:
- nada → menu principal (`catalog.ts`, agrupado, em português); `keys`/`persona`/`knowledge` sozinhos → submenu; entradas com argumento perguntam o valor (`ask`)
- 1 palavra parecida com um comando (Levenshtein ≤ 2) → "Você quis dizer…? Rodar agora?"
- qualquer outro texto → `askLocal('intent')` (Groq na nuvem, senão qwen2.5-coder/llama3.2) com o catálogo; `parseIntent` só aceita comando e subcomando reais → confirm → roda; sem resposta válida → oferece o menu
- o resultado vai para `program.parseAsync(argv, { from: 'user' })`

Pré-requisitos encadeados: `loadContext()` (`modules/init/ensure.ts`) oferece o `init` quando falta o `kvasir.context.md`; `task` oferece o `branch`; `knowledge` vazio oferece o `add`; `models --cloud on` sem chave oferece o `keys set`.

### `kvasir init`
1. Lê o `package.json`; `findPersonaForPackage` sugere a persona cujo `match` aparece no `name` (ela vem primeiro na lista).
2. Detecta a stack pelas deps: `next` → Next.js · `expo` → React Native + Expo · `express`/`fastify` → Node.js API · sempre TypeScript.
3. O usuário escolhe a persona (`listPersonas`: embutidas + `~/.kvasir/personas/*.json`) ou "nenhuma" (para sem escrever nada). `loadPersona` valida o JSON com zod.
4. Pede `confirm()` e então escreve `kvasir.context.md` (prefixos, idioma de branch e de commit vêm da persona; a task ativa existente é mantida) e roda os 3 adapters.
5. `CLAUDE.md` usa `~/.kvasir/templates/<persona>-mobile.md` (se tem `expo`/`react-native`) ou `<persona>-web.md` (se tem `next`), quando existem; senão, um corpo gerado (scripts, árvore de pastas, regras e a seção da persona).

### `kvasir commit`
1. Lê `git diff --cached`. Se estiver vazio, oferece `git add -A`.
2. `guardStagedChanges()` (a menos que `--no-guard`): se o guard cancelar, para; se tirou arquivos do stage, relê o diff.
3. `askFor('commit', temperature 0.2)` com `--stat` + diff cortado em 12k caracteres → `pickLine` pega a linha no padrão Conventional Commits; avisa se não seguir o padrão ou passar de 72 caracteres.
4. Pergunta: Sim / Não / Editar (abre o editor). Registra o feedback em `commits.md`.
5. `git commit -m` → nota em `knowledge/commits/<projeto>.md`.
6. Menu em loop: push (com cancelar) · undo (encerra o menu) · log · merge (pede confirmação e oferece voltar à branch) · sair. Uma ação git que falha mostra o erro e volta ao menu.

### `kvasir guard` (também chamado pelo `commit`)
1. Arquivos no stage (`getStagedFiles`) e linhas adicionadas (`parseAddedLines`), menos o que o `.kvasirignore` cobre.
2. Regras determinísticas (`guard/rules.ts`, por especificação): 🔴 chave AWS/Google/GitHub/Stripe live, chave privada, JWT, senha/segredo atribuído (ignora `process.env` e placeholders), cartão que passa no Luhn, arquivos `.env*` (exceto `.env.example` e parecidos), `.pem/.p12/.key/.keystore/.jks`, `google-services.json`/`GoogleService-Info.plist`; 🟡 CPF/CNPJ válidos (dígito verificador), `console.log` com token/senha/cartão/cpf.
3. Strings entre aspas com 20+ caracteres e entropia ≥ 4 que nenhuma regra pegou → `askLocal('guard')` decide (`S1: SEGREDO …` / `S1: OK …`); SEGREDO vira 🔴. Ollama fora do ar → 🟡.
4. Relatório com trecho mascarado (`AKIA****MPLE`). Só 🟡 → "continuar?". Algum 🔴 → cancelar · tirar os arquivos do stage (`git restore --staged`) · ignorar (segunda confirmação, feedback em `guard.md`).
5. Ao ignorar/continuar, oferece gravar no `.kvasirignore`: arquivo pelo caminho e valores por `hash:<sha256>` (nunca o segredo em texto). Entradas manuais: glob de caminho, `rule:<id>`, `match:<texto>`.

### `kvasir pr`
1. Branch atual; base sugerida pelo Git Flow (`hotfix/` e `release/` → main/master, o resto → develop), local ou `origin/`, só as que existem; se houver mais de uma, o usuário escolhe.
2. Fatos por código (`pr/description.ts`): commits `base..HEAD`, `git diff --stat` e diff `base...HEAD` (até 10k), tipo pelo prefixo da branch (`feature/` → `feat`), "mexeu em tela" (`.tsx/.jsx` em `screens/`, `components/`, `pages/`, `app/`…), task ativa.
3. `askFor('pr', temperature 0.3)` (com as preferências do `profile.md`) devolve `TITULO:`, `## O que mudou` e `## Como testar`; `parsePrDraft` garante o prefixo do tipo e no máx. 72 caracteres.
4. `buildPrBody` monta o markdown: o que mudou · como testar · prints/vídeos (só com mudança de tela) · checklist (testes, lint, tipos) · task · commits (em `<details>`).
5. Menu: copiar (clipboard) · criar com `gh pr create` (só se o `gh` existe; faz `git push -u` antes se a branch não tem upstream, com confirmação; corpo via `--body-file`) · editar (editor externo, 1ª linha = título) · gerar de novo · cancelar. Copiar/criar = aprovado, gerar de novo/cancelar = rejeitado nas métricas; a URL do PR vai para a nota da task.

### `kvasir daily`
1. Repositórios: `--repos <pasta>` (procura `.git` até 2 níveis; oferece salvar) → `~/.kvasir/config.json` (`daily.repos`) → repositório atual (oferece salvar).
2. Período (`daily/summary.ts`): de 00:00 de ontem; na segunda e no fim de semana, desde sexta; `--since` substitui.
3. Commits do autor: `git -C <repo> log --all --no-merges --author=<user.email do repo> --since=…`.
4. "Ontem": `askLocal('daily')` (llama3.2 → qwen2.5-coder, sem clipboard: é texto de baixo risco que o usuário revisa) com exemplo de formato e "traduza o sentido"; sem commits, pergunta. "Hoje": sugere a task ativa. "Impedimentos": padrão "Nenhum".
5. `buildDailyMessage` monta o texto; copiar · editar · gerar o "Ontem" de novo · cancelar. Copiada → `knowledge/commits/daily.md`.

### `kvasir release`
1. Recusa se há algo no stage, mudança pendente em `package.json`/`package-lock.json`/`app.json`/`CHANGELOG.md`, ou se a tag já existe (nada é alterado).
2. Commits desde `git describe --tags --abbrev=0` (todos, se não há tag), com corpo; `parseCommit` (`release/semver.ts`) lê tipo, escopo, `!` e `BREAKING CHANGE:`.
3. `detectBump` (determinístico): breaking → major · feat → minor · fix/perf → patch · só manutenção → avisa. O usuário escolhe a sugerida, outra, ou digita.
4. `buildChangelogSection` (`release/changelog.ts`): ⚠️ incompatíveis · novidades · correções · desempenho · outras (`chore` fica de fora); entra logo abaixo de `# Changelog`.
5. `applyVersion` (`release/versionFiles.ts`): `package.json`, `package-lock.json` (raiz e `packages[""]`), `app.json` (`expo.version`, `android.versionCode` +1, `ios.buildNumber` +1), mantendo indentação e EOL; `app.config.*` só gera aviso.
6. Commit `chore(release): vX.Y.Z` só com esses arquivos + tag anotada com a seção do CHANGELOG → nota em `knowledge/commits/<projeto>.md`.
7. Notas (opcional): `askLocal('release')` recebe só as mudanças que o usuário percebe (feat/fix/perf/breaking) e reescreve **uma por uma**; copia se aprovado.
8. Expo: sugere `eas update --branch production --message "vX.Y.Z: …"`. Oferece `git push --follow-tags` se houver upstream.

### `kvasir test [arquivo]`
1. Arquivos: o informado, ou os `.ts/.tsx` alterados (`git status`, inclusive dentro de pastas novas), sem testes/`.d.ts`/configs; checkbox se forem vários.
2. `detectTestSetup` (`test/framework.ts`): vitest ou jest (`jest-expo` conta) pelo `package.json`, Testing Library (RN ou web), convenção (`__tests__/` ou `<nome>.test.ts` ao lado) e o teste existente mais próximo como exemplo de estilo. Sem framework → dica de instalação.
3. `buildGeneratePrompt` (`test/prompt.ts`): código, exports (`listExports`), **linhas de import prontas** (`buildImportLines`: nomeado × default × `import type`), regras do framework, "só valores que os tipos aceitam", 3 a 8 testes.
4. `askLocal('test')` (qwen2.5-coder → deepseek-r1) → mostra → confirmação → salva.
5. `runTestFile` (`utils/testRunner.ts`): `node node_modules/jest/bin/jest.js <arq> --ci --colors=false` ou `node node_modules/vitest/vitest.mjs run <arq>` (sem shell, sem npx; `CI=1`, `NO_COLOR=1`).
6. Falhou → `buildFixPrompt` com a saída: erro de import/sintaxe/tipo é sempre culpa do teste; se uma asserção de comportamento falhou e o código está claramente errado, a IA responde `BUG: …` → o teste fica falhando como evidência e vai para `knowledge/errors/bugs-encontrados-por-testes.md`. Até 3 tentativas; depois, manter ou apagar.

### `kvasir persona`
- `list`: embutida (`default`) + personalizadas em `~/.kvasir/personas/` (uma embutida editada aparece como "embutida, personalizada").
- `show <nome>`: stack, padrão de repositório, prefixos de branch com descrição e idioma, convenção e idioma de commit.
- `create`: nome (slug), copiar uma persona existente ou começar do zero, stack, prefixos (pergunta para que serve cada prefixo novo: é o que o prompt da branch usa), idioma de branch e de commit, padrão de repositório → confirma → salva.
- `remove <nome>`: personalizada → apaga; embutida → apaga só a cópia local (volta à versão embutida).

### `kvasir doctor`
Sem IA (determinístico). Uma checagem por arquivo em `modules/doctor/checks/`, cada uma devolve `{ name, status: ok|warn|fail, detail, fix }`:
- `node.ts`: `process.version` × `engines.node` do projeto (`>=`, `^`, `~`, `||`), npm, yarn
- `git.ts`: git, `user.name`, `user.email`
- `mobile.ts` (só se o projeto tem `expo` ou `react-native`): JDK 17, `JAVA_HOME` existe e é o mesmo JDK do `java` do PATH, `ANDROID_HOME`, `adb`, `android/gradlew`, versão do Expo, EAS CLI (versão nova?) e `eas whoami`
- `ollama.ts`: rodando? cada modelo do `MODEL_MAP` instalado (casa tags como `:7b`)? alguma tarefa sem nenhum modelo → ❌
- `kvasir.ts`: `~/.kvasir`, `kvasir.context.md`, `profile.md`, comando `code`, `gh` + `gh auth status`
- `shared.ts`: `probe()` primeiro pergunta ao sistema se o executável existe (`commandExists` = `where`/`which`), depois roda com timeout de 15s. Via `cmd /c`, comando inexistente sai com 1 como qualquer erro, e a mensagem "não é reconhecido" vem traduzida e com acento quebrado: nenhuma das duas serve para detectar
- No fim: resumo e, se faltar modelo, oferece `ollama pull` (com confirmação).

### `kvasir branch`
1. Pergunta a descrição da tarefa → `loadConventions` (prefixos, descrições e idioma da persona do projeto) → `askFor('branch', temperature 0.2)` (resumo em inglês ou em português, conforme a persona) → `parseBranchName` acha `prefixo/…` com os prefixos da persona, remove rótulos e acentos, descarta prefixo desconhecido e usa o primeiro da persona como padrão.
2. Sim / Não / Editar → `git checkout -b`.
3. Menu em loop: deletar outra branch · listar · voltar para a anterior · sair.
- `-l` lista locais e remotas · `-d` deleta (pergunta se força `-D` quando não está mergeada).

### `kvasir fix`
```
erro: se o clipboard já tem um erro do tsc, usa direto; senão pergunta (clipboard · typecheck · 1 linha)
   │
   ├─ parseTscDiagnostics: "arq.ts(12,5): error TSxxxx" e "arq.ts:12:5 - error TSxxxx"
   │    nenhum diagnóstico → askFor('fix') sugere (só mostra; "foi útil?")
   │
   ├─ classifyError (alvo = 1º erro colado):
   │    complexo = erros em vários arquivos · > 5 erros · arquivo de config · código de
   │               resolução de módulo/config (TS2307, 2305, 2614, 2792, 2688, 1259, 1192, 5xxx, 18003)
   │               · mensagem citando tsconfig/babel/moduleResolution
   │    simples  = o resto
   │
   ├─ simples: corrige cada erro colado nesse arquivo SEM PERGUNTAR
   │    1. regra determinística comprovada (TS6137: '@types/X' → 'X', pela mensagem do tsc)
   │    2. senão askFor('fix'): trecho numerado ±15 linhas, linha marcada com >>, pede SÓ a linha
   │    backup em ~/.kvasir/backups/fix/ · preserva CRLF/LF · ANTES/DEPOIS · diff no VS Code
   │    → nota em knowledge/errors/<código>.md
   │
   ├─ complexo (ou simples que falhou, sem perguntar): só a regra determinística mexe no
   │  arquivo; o resto vai para investigateComplexError → askFor('architect', timeout 300s) com:
   │    arquivo do erro (trecho), imports locais resolvidos (relativos + paths do tsconfig, até 5,
   │    120 linhas cada), tsconfig.json, versões das libs, e para import que não resolve:
   │    "arquivos do projeto com o mesmo nome" · pode perguntar (PERGUNTA:) até 3 vezes
   │    → mostra o relatório; se "útil", vira nota em errors/
   │
   ├─ recorrência: `recentErrorOccurrences` conta o código em knowledge/errors nos últimos 7 dias;
   │  a partir da 3ª: "🔁 Este é o 3º TSxxxx…" → oferece askFor('architect') com o histórico,
   │  tsconfig e versões para achar a causa comum (útil → vira nota)
   │
   ├─ depois de aplicar: typecheck, "Encontrei mais N erro(s) TSxxxx em M arquivo(s)",
   │  confirm → regra ou askLocal('fix') → nota de expansão em errors/ → typecheck final
   │
   └─ kvasir fix --undo restaura todos os arquivos do último fix
```

### `kvasir doc <lib>`
npm registry → (sem README? tenta `raw.githubusercontent.com` em `main`/`master`) → `askFor('doc', maxTokens 2048)` → confirm → salva em `DOC/libs/` e `~/.kvasir/knowledge/libs/` (com a linha `Usado em: [[projeto]]`, juntando projetos).

### `kvasir doc --code`
- `--code <arquivo|pasta>`: documenta o arquivo, ou cada arquivo da pasta com confirmação.
- `--code`: menu de pastas da raiz (com contagem) → checkbox de arquivos, ou "arquivo específico" / "projeto inteiro".
- `--code --all [--force]`: projeto inteiro com progresso, pulando o que já tem doc (a menos que use `--force`).
- Usa `askLocal('doc')` (llama3.2 → qwen2.5-coder, sem clipboard), passa a lista de exports extraída por regex para o modelo não inventar nomes, e ignora `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage` e `DOC`.

### `kvasir review`
1. `parseAddedLines` (`utils/diff.ts`) pega as linhas adicionadas com o número real da linha; linhas vazias ou só com chaves saem; máx. 150.
2. Cada linha recebe um id (`L1`…`Ln`). O prompt pede um veredito **por linha** (`L3: OK` ou `L3: PROBLEMA [bug|segurança|estilo] … — …`), com um exemplo do formato e o que conta como problema. Sem regras fixas: pedido como "lista de problemas", o qwen2.5-coder respondia "nenhum problema"; linha por linha ele encontra.
3. `parseFindings` mapeia o id de volta para `arquivo:linha` (qualquer veredito que não seja OK conta).
4. `askFor('review', temperature 0.1, repeatPenalty 1.1, maxTokens = 40 por linha)` → mostra → "As sugestões foram úteis?" → `patterns.md` + métrica; se útil, nota em `knowledge/patterns/review-<projeto>.md`.

### `kvasir keys`
`keys` mostra se cada chave está configurada (nunca mostra a chave). `keys set [gemini|groq]`: link para criar a chave → entrada oculta → aviso se o prefixo não bate (`AQ.`/`AIza` no Gemini, `gsk_` no Groq, de `CLOUD_KEY_INFO`) → `checkCloudKey` (lista modelos, sem gerar) → confirm → `writeUserEnv` (`setx` no Windows) → se a nuvem não estiver permitida, pergunta o consentimento. `keys remove`: confirm → `removeUserEnv`.

### `kvasir models`
Lista os modelos instalados no Ollama, o status de cada modelo do `MODEL_MAP` e o primeiro instalado por tarefa.

### `kvasir learn`
Últimos 150 registros de feedback + `profile.md` → `promptAI` → `extractProfile` → confirm → salva `~/.kvasir/profile.md` → escreve `knowledge/agents/<modelo>.md` com o desempenho de cada modelo (métricas dos últimos 30 dias).

### `kvasir knowledge`
- Escrita sempre por `modules/knowledge/notes.ts` (`saveNote` em modo `append` ou `replace`): frontmatter, tags e projetos mesclados, `index.md` regenerado. Notas sem frontmatter (antigas/manuais) são lidas com padrões.
- Notas automáticas: `modules/knowledge/auto.ts` (`noteFixedError`, `noteBatchFix`, `noteInvestigation`, `noteCommit`, `noteTaskActivated`, `noteTaskBranch`, `noteUsefulReview`, `noteAgentPerformance`). Uma falha ao gravar só avisa; nunca quebra o comando.
- `add`: categoria (inclui "Erro resolvido") + título + conteúdo (1 linha ou clipboard); nome seguro `[a-z0-9-]`; pergunta antes de substituir.
- `search` (nome e conteúdo, mostra a linha) · `link` (`Relacionado: [[nota]]` sem duplicar) · `show` (regenera e mostra o `index.md` + caminho do vault, e gera o grafo `~/.kvasir/reports/knowledge.html` com `knowledge/graph.ts`: notas + `[[links]]`, tags opcionais, offline).

### `kvasir watch`: erros de execução (`utils/runtimeErrors.ts` + `modules/fix/runtime.ts`)
`handleText` tenta erros de tipo (`parseTscDiagnostics`) e, se não houver, `parseRuntimeErrors` (erro + frames do projeto + assinatura). `processRuntimeErrors`: desfaz provisórias cujo erro voltou (`undoIfBack`), limita 3 tentativas por assinatura, espera o arquivo parar e chama `autoFixRuntimeError`: contextos (arquivos do stack + importados pelo teste) → `askLocal('fix')` com formato ARQUIVO/LINHA → recusa teste/esconder → grava com backup → `findNewErrors` (typecheck) → reroda o teste que falhou (confirmada) ou os testes do arquivo (provisória). Provisórias guardam conteúdo original, conteúdo corrigido e a chamada, para desfazer e rejeitar se o erro voltar.

### `kvasir watch` (`modules/watch/` + `modules/fix/auto.ts`)
Entrada: clipboard (a cada 1,5 s) ou `spawnCommand` do comando depois de `--` (saída repassada; parada 1,5 s com erros = rodada). `processErrors`: typecheck do projeto como verdade → até 5 rodadas de "1º erro de cada arquivo" → `autoFixDiagnostic` → nova linha de base. `autoFixDiagnostic`: regra (`line.ts`) ou `askLocal('fix')` com `knownFixesFor` → `hidingReason` → grava (backup em `fix/backup.ts`, só se o arquivo não mudou) → `compareDiagnostics` (antes × depois) → `runRelatedTests` → ok: `recordOutcome(approved)`, chamada no manifesto, nota; falha: restaura o conteúdo lido, `recordOutcome(rejected)` e 2ª tentativa com `previousAttempt`. `undoLastFix` grava `recordOutcomeForCall(rejected)` das chamadas do manifesto.

### Sugestões proativas (`modules/proactive/`)
`offerSuggestion` (index.ts): uma por comando; modo por sugestão em `~/.kvasir/proactive.json` (`ask` / `auto` / `off`, últimas 10 respostas, "não perguntar" por chave). ≥ 5 respostas com ≥ 90% sim → oferece `auto` (só onde `AUTO_ALLOWED`); ≤ 20% → `off`. Os fatos estão em `suggestions.ts`: `offerBranchForTask` (commit, start), `offerReviewBeforeCommit` (commit, antes da IA; o review grava o hash com `markDiffReviewed`), `offerDocNewLib` (commit, depois de commitar), `offerStaleBranch` (start). Os runners das sugestões são importados sob demanda (evita ciclo review ↔ proactive). Erro numa sugestão só é mostrado; nunca derruba o comando.

### `kvasir docs update` (`modules/docs/`)
`collectDocsFacts` (facts.ts): base = `lastCommitTouching(README + pasta de docs)` ou `--since` → `getChangedFilesSince` (código), diff, `listExports` agora e na base (`getFileAtRef`), scripts antes × agora → termos (caminhos, arquivos, exports com cara de código, `npm run x`) → documentos candidatos com `stale` (citados e sumidos) e `undocumented` (novos e não citados). `buildDocsPrompt` (prompt.ts) → `askLocal('docs')` → `parseDocsAnswer` (seções) → `checkEdit` + `replaceSection`/`appendSection` (sections.ts) → `lineDiff` → aplicar / VS Code / pular, com backup.

### `kvasir stats` / `kvasir board`
`collectStats(dias)` (`modules/stats/data.ts`) lê só o `~/.kvasir`: métricas, `board.json` (jobs ao vivo de `ai/jobs.ts`), notas do knowledge e `profile.md` → `renderStatsHtml` (`html.ts`, HTML único com SVG desenhado por um script pequeno, sem CDN) → `~/.kvasir/reports/stats.html` → abre com `openInDefaultApp` (sem shell). `--watch`/`board`: regrava a cada 3 s e a página se recarrega. Jobs: o router chama `startJob` antes do 1º candidato, `switchJobModel` a cada fallback e `finishJob` no fim; lotes chamam `queueJobs` antes e `clearQueuedJobs` no `finally`.

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
