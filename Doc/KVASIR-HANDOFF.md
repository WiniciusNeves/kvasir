# Kvasir: handoff

> Passagem de bastão entre sessões. Atualizado no fim de cada fase.
> Branch de trabalho: `fix/kvasir-fix-and-editor`

## Plano

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Análise de `src/` | ✅ concluída (2026-10-17) |
| 2 | Correções: `fix`, menu pós-commit, remover `shell: true`, prompts do Ollama | ✅ concluída (2026-10-17) |
| 3 | Testar `review`, `task`, `start`, `learn`, `knowledge` | ✅ concluída (2026-10-17) |
| 4 | Mapa completo do backlog v2 (`Doc/ideas/backlog.md`) | ✅ ordem em ondas aprovada (2026-10-17) |
| 4.A | Onda A: conflitos com os princípios, métricas, knowledge v2 | ✅ concluída (2026-10-17) |
| 4.B | Onda B: guard → doctor → pr → daily → release → test, fix aprende erros recorrentes, personas | ✅ concluída (2026-10-17): `guard` (`5c2b1da`), `doctor` (`3c1c78f`), `pr` (`685f7bd`), `daily` (`b4ec48f`), `release` (`ba2036f`), `test` (`c23372d`), recorrência no `fix` (`6f8d467`), personas (`42b6a8f`) |
| 4.C | Onda C (Fase 5): Gemini + Groq + fallback Ollama, escolha por desempenho, time de agentes formal | ✅ concluída (2026-10-18): Gemini + Groq + fallback ✅ (`45624ea`); escolha por desempenho ✅ (2026-10-18); time de agentes formal ✅ (2026-10-18). **Onda C concluída** |
| 4.D | Onda D: `kvasir stats` + Agent Board + grafo do knowledge | ✅ concluída (2026-10-18) |
| 4.E | Onda E: E1 perguntas proativas com autonomia por confiança · E2 `kvasir watch` que corrige e valida sozinho · E3 erros de runtime | ✅ concluída (2026-10-18): E1 e E2 (PR #1), E3 (PR #2), ambos mergeados |
| 4.F | Onda F: F1 OmniContext (`index` + `ask`) · F2 respostas no knowledge + os outros comandos usando o contexto + reindexação automática · F3 `docs update` · F4 `deploy` | 🔧 F1 ✅ (PR #3, mergeado) · F2 ✅ (PR #4) · F3 ✅ (2026-10-20, branch `feature/docs-update`) |
| 5 | Gemini Flash + Groq no router, com fallback para Ollama | ⏳ |

---

## Fase 1: resultado da análise

### `kvasir fix`
- A correção determinística do TS6137 removia `type` do import. O TS6137 pede para trocar o **caminho** (`'@types/X'` → `'X'`)
- A regra determinística era "aplicada" mesmo sem mudar nada; usava qualquer código TS do texto, não o da linha
- No caminho complexo, o relatório em markdown (`## Causa raiz`) virava o conteúdo da linha
- O regex de linha só entendia `arq.ts:12:5`, mas o typecheck sem TTY imprime `arq.ts(12,5)`
- Colar erro com várias linhas no `input()` (de uma linha só) truncava o erro e vazava para os prompts seguintes
- A expansão era recursiva e mandava para a IA um erro sintético sem a mensagem real
- `runTypecheck` dava "resolvido" quando o script `typecheck` não existia
- Ctrl+C deixava o arquivo modificado; CRLF misturado; logs de DEBUG

### `editor.ts`
- `spawnSync('code.cmd')` sem shell lança `EINVAL` no Node ≥ 18.20 (Windows); `exec` assíncrono imprimia erro no meio do prompt

### Por que o Ollama erra
- O prompt do fix pedia "linha com erro **e** a corrigida", e o parse pegava a 1ª (a errada)
- Arquivo inteiro sem números de linha, sem dizer qual linha corrigir
- Regra do TS6137 errada no prompt
- Sem `num_ctx`: o Ollama corta o início do prompt (onde estão as regras)
- `<think>` do deepseek-r1 não era removido; timeout de 30s fazia cair no fallback em silêncio
- Nomes sem tag (`qwen2.5-coder`) dão 404 se o modelo foi instalado como `:7b`
- Sem `temperature`; diff do commit sem limite; `doc --code` usando codellama
- `promptAI` lia a resposta do Claude com `input()` de uma linha (afeta todos os módulos)

### Outros
- `git.ts`: nenhum helper confere `status` (commit/branch/push que falham mostram ✅)
- `commit`: o menu pós-commit já existe em loop; o merge não pede confirmação
- `push` sem opção de cancelar; `branch` sem validação do nome
- `review` não aplica nada (#3); `format` usa `execSync` (#5); textos em inglês (#7)
- `{ shell: true }`: `utils/typecheck.ts`; shell implícito em `editor.ts` (`exec`) e `format` (`execSync`)

### Faltando
`guard`, `pr`, `daily`, `release`, `doctor`, `test`; `task` gravando a task ativa; `profile.md`/`knowledge` nos prompts; Gemini/Groq; testes automatizados.

---

## Fase 2: o que mudou

Nada commitado ainda; tudo na branch `fix/kvasir-fix-and-editor`. `npm run build` passa.

### 2.1 `kvasir fix` (+ editor, typecheck, camada de IA)
| Arquivo | Mudança |
|---|---|
| `modules/fix/index.ts` | Reescrito. Erro vem do clipboard / typecheck / 1 linha → corrige o arquivo do erro **sem perguntar** → diff no VS Code → "Encontrei mais N erro(s) TSxxxx em M arquivo(s)… corrigir os outros?" → typecheck final. Regra TS6137 corrigida (troca o caminho). Prompt com trecho numerado e pedido de UMA linha. Parse robusto. Backup em `~/.kvasir/backups/fix/` + `kvasir fix --undo`. Sem logs de DEBUG. Preserva CRLF |
| `cli/fix.ts` | Opção `--undo` |
| `utils/editor.ts` | `code --diff` via `runCommand` (funciona no Windows/Node 24), síncrono, retorna se abriu |
| `utils/typecheck.ts` | `tsc` local via `node` (`--pretty false`), fallback para o script `typecheck`; `success` exige exit 0; `parseTscDiagnostics` entende os 2 formatos, caminhos do Windows e ANSI |
| `utils/process.ts` (novo) | `runCommand(bin, args)` sem `shell: true` (Windows: `cmd.exe /d /s /c` com escape) |
| `ai/ollama.ts` | `num_ctx` 8192, `temperature`, remove `<think>` |
| `ai/router.ts` | Resolve nomes de modelo pelas tags instaladas; erro claro se o Ollama estiver fora; timeout 120s; avisa quando cai no fallback; `askLocal` (sem clipboard); `qwen2.5-coder` primeiro em commit/branch |
| `ai/client.ts` | `promptAI` lê a resposta do clipboard (várias linhas); `readClipboard()` |

**Testes feitos:** TS6137 em 2 arquivos (corrige a.ts sem perguntar, acha b.ts, corrige, typecheck limpo, CRLF preservado, `--undo` restaura); `runCommand` com espaço/`&`/`()`/`%`/aspas; parser com 8 formatos de resposta; qwen2.5-coder real: TS2551 (`lenght`→`length`) e TS2322 (`parseInt`) corretos. O 1º pedido levou 40s (carga a frio), o que confirma o problema do timeout antigo de 30s.

### 2.2 `kvasir commit`: menu pós-commit em loop
O loop já existia. Corrigido: helpers do git conferem `status` (`assertGitSuccess`); erro numa ação mostra a mensagem e volta ao menu; undo encerra o menu; merge pede confirmação e oferece voltar à branch; push tem "Cancelar". **Testado:** commit → log → undo (menu fecha).

### 2.3 `shell: true`
Removido de `utils/typecheck.ts`; `exec` saiu do `editor.ts`, `execSync` saiu do `format`. `grep` não acha mais nenhum.

### 2.4 Prompts do Ollama
`ai/parse.ts` (novo): `cleanAnswer`, `answerLines`, `pickLine`, `truncateForPrompt`.
- **commit**: `--stat` + diff até 12k, regras de formato no fim, parse pelo padrão Conventional Commits, aviso de padrão/72 chars. Real: `feat(push): add cancel option`
- **branch**: pede tradução + kebab-case; parse acha `prefixo/…`, tira rótulos/acentos. Real: `fix/cart-empty-crash`
- **review**: português, lista `[tipo] arquivo — problema — sugestão`, "Nenhum problema encontrado."
- **doc <lib>**: README primeiro, instalação e links passados prontos
- **doc --code**: `askLocal('doc')`, exports extraídos por regex e passados ao modelo

### Pendências conhecidas
- O caminho interativo do `fix` com `askFor` (2 idas ao Claude) não foi testado com um Claude real, só o `askLocal`
- `branch` (menu e `-d`) e `push` contra remoto real não foram retestados
- A regra do TS6137 troca `'@types/X'` por `'X'`; num projeto com alias `@types/*` (como o kvasir antigo) o certo é renomear o alias, e o typecheck depois vai mostrar isso

---

## Fase 3: testes e correções

Fase 2 commitada em `418918d`. Os testes da Fase 3 rodaram com `USERPROFILE` temporário (não tocam o `~/.kvasir` real) e um repositório git temporário; o Claude foi simulado colocando a resposta no clipboard. (Os testes da Fase 2 tinham gravado 4 linhas de feedback no `~/.kvasir` real; foram removidas.)

| Módulo | O que quebrou | Correção | Resultado |
|---|---|---|---|
| `review` | qwen2.5-coder não viu um `<=` fora do array, repetiu o mesmo item 10x e inventou "falta tipo" | `review/checks.ts`: checagens determinísticas nas linhas adicionadas (segredo, `<= .length`, `any`, `console.log`, `debugger`) com nº da linha; prompt com o que já foi achado; `repeat_penalty` 1.2 + `maxTokens` 700; itens sem duplicata, máx. 10 | Os 3 problemas achados com a linha exata; a IA respondeu "Nenhum problema encontrado." em vez de inventar |
| `task` | Erro cru do axios (`status code 401`); dizia "rode kvasir branch para vincular a task", mas nada era gravado; resposta da API sem validação | Mensagens em português; zod valida `{ id, title, status }`; confirmação grava `## Active task` (`setActiveTask`, só essa seção) | Testado com Planner falso: lista, escolhe, grava |
| `start` | `ECONNREFUSED` abortava o resumo do dia | Falha do Planner vira aviso; resumo segue até "Pronto para trabalhar" | ok com e sem API, com servidor fora e com token errado |
| `branch` | Não usava a task | Descrição pré-preenchida com a task ativa; branch criada é gravada em `linked branch` | Testado: `feature/google-login` vinculada a `TASK-42` |
| `learn` | Salvava a frase "Aqui está…" e as cercas ``` dentro do `profile.md`; prompt em inglês; feedback sem limite | `extractProfile`; prompt em português; últimos 150 registros | `profile.md` salvo limpo; sem feedback, mensagem clara |
| `knowledge` | Título com `/` e `:` criava subpasta + **stream NTFS**: a nota sumia do `show`/`search`; sobrescrevia sem avisar; conteúdo de 1 linha; `link` duplicava | Nome seguro `[a-z0-9-]`; pergunta antes de substituir; conteúdo pelo clipboard; link sem duplicar; `search` mostra a linha | add/show/search/link ok |
| `doc <lib>` | (achado junto) `@tanstack/react-query` criaria subpasta `@tanstack/` | `toLibFileName` → `tanstack__react-query.md` | — |

Todos os textos desses módulos estão em português. Sobra inglês só em `init` e `doc --code` (#7).

### Pendências
- `push` contra um remoto real, `format` e o menu do `branch` não foram testados
- O caminho interativo com um Claude real (colar no chat) não foi testado; o clipboard foi simulado

---

## Fase 4: mapa completo (fonte: `Doc/ideas/backlog.md`, backlog v2)

Mapa feito na Fase 4 (2026-10-17) e **reconferido no `src/` em 2026-10-20**, depois das ondas A a F2.
Legenda: ✅ existe · 🟡 parcial · ❌ falta · Esforço: B (baixo) · M (médio) · A (alto)

### Conflitos com os princípios (todos resolvidos)
| O quê | Princípio | Como foi resolvido |
|---|---|---|
| `review/checks.ts`: regex para `<= .length`, `any`, `console.log` compensando a IA | "Nunca contornar IA com regra fixa" | ✅ Onda A: regras de segredo foram para o `guard`; o review ficou com veredito linha a linha pelo prompt |
| `fix` sem a classificação simples × complexo e perguntando antes de investigar | Bloco 8 + "corrige direto sem perguntar" | ✅ Onda A: classificação de volta; complexo investiga direto com imports, tsconfig e versões |
| `askFor` mandava o prompt inteiro ao Claude 2 vezes (escolher + validar) | "Zero token desperdiçado" | ✅ 2026-10-20: escolha pelo desempenho medido; o Claude valida só até o modelo provar que acerta (`ai.claudeValidation`) |
| Soluções do `fix`/`review` não eram salvas | "Conhecimento gerado fica salvo" | ✅ Onda A: notas automáticas em `knowledge/` |

### Status por bloco
| Bloco | Item | Status | Depende de | Esforço |
|---|---|---|---|---|
| **1 Knowledge** | Vault do Obsidian: pastas, frontmatter, `[[links]]`, `index.md` automático | ✅ Onda A | — | — |
| | Notas automáticas (`fix`, `commit`, `task`, `review`, `learn`, `doc`, `ask`) | ✅ (`answers/` desde a F2) | — | — |
| | `search/add/link/show` + grafo HTML | ✅ (grafo: onda D) | — | — |
| | `profile.md` usado nos prompts | ✅ (router injeta as preferências) | — | — |
| | Sync entre PCs | ❌ | bloco 13 | B |
| **2 OmniContext** | `src/rag/`, `index`/`ask`, embeddings locais, índice próprio, busca híbrida | ✅ F1 | — | — |
| | Respostas viram conhecimento; contexto nos prompts de `fix`/`watch`/`review`/`test`; `index --watch` | ✅ F2 | — | — |
| | PDFs, outros repositórios, backend Qdrant, sync Windows ↔ Mac | ❌ | — | M |
| **3 Módulos** | `guard`, `doctor`, `pr`, `daily`, `release`, `test` | ✅ onda B | — | — |
| **4 Time de agentes** | 5 agentes, dono único, contexto isolado, substituíveis (`kvasir agents`) | ✅ onda C | — | — |
| | Avaliar agentes extras do Ollama (codex, opencode, hermes, cline…) | ❌ | métricas | M |
| **5 Agent Board** | Kanban ao vivo por agente, métricas, "em que cada IA é melhor" | ✅ onda D (`kvasir board`) | — | — |
| **6 AI Router** | Gemini + Groq + fallback Ollama, `kvasir keys` | ✅ onda C | — | — |
| | Escolha por desempenho; Claude valida só até o modelo provar que acerta | ✅ (validação: 2026-10-20) | — | — |
| | Oferece baixar modelos que faltam (`doctor`) | ✅ | — | — |
| **7 Intenção** | `kvasir <frase>` → comando do catálogo, menu, erro de digitação | ✅ (sempre confirma) | — | — |
| | Comandos só de leitura rodarem direto; voz | ❌ | — / widget | B / A |
| **8 `fix` inteligente** | Sem perguntar, simples × complexo, investigação, diff, backup, `--undo`, recorrentes | ✅ | — | — |
| **9 Aprendizado** | Feedback, `learn` → `profile.md`, perguntas proativas com autonomia por confiança | ✅ | — | — |
| | `kvasir watch`: tipo e runtime, validação em camadas | ✅ onda E | — | — |
| **10 Stats e deploy** | `kvasir stats` | ✅ onda D | — | — |
| | `kvasir deploy` (EAS Build/Submit/Update; Vercel) | ❌ F4 | `doctor`, `release` | A |
| **11 Desktop** | Widget, wake word, Whisper, TTS, ver a tela | ❌ (Electron × Tauri pendente) | CLI estável | A |
| **12 Auto-melhoria** | Níveis de autonomia unificados (1 pergunta / 2 seguro sozinho / 3 autônomo em branch) | 🟡 `ai.autonomy` no `watch`, confiança no `proactive`; falta o nível 3 | — | M |
| | Módulo fraco → patch em `chore/self-improve-*` → build + testes → relatório | ❌ | métricas | A |
| | Plugins (`plugin install/create`) | ❌ | API de módulos estável | A |
| **13 Infra/produto** | GitHub, contexto entre IAs (adapters), personas criar/listar/remover | ✅ | — | — |
| | `kvasir setup` / instalador | ❌ | `doctor` | M |
| | `~/.kvasir` sincronizado, servidor 24h + Tailscale | ❌ | — | B |
| | LICENSE | ✅ MIT © WiniciusNeves (2026-10-20) | — | — |
| | Projeto open source: CI, guia de contribuição, segurança, conduta, templates, regras da `main` | ✅ (2026-10-20) | — | — |
| **14 Tarefas** | Task ativa ↔ branch ↔ contexto, `kvasir start` | ✅ | — | — |
| | Microsoft Planner real (Graph API + OAuth) | 🟡 hoje é um GET genérico | conta Microsoft | M |
| | Task manager próprio da empresa | ❌ | API da empresa | M |
| | `kvasir docs update` | ✅ F3 (2026-10-20) | — | — |

### Ordem sugerida (ondas)
| Onda | Conteúdo | Por quê |
|---|---|---|
| **A: corrigir e fundar** | 1) Resolver os conflitos com os princípios (review, classificação do `fix`) · 2) **Métricas no router** (chamadas, tokens, tempo, aprovação por modelo/tarefa em `~/.kvasir/metrics/`) · 3) **Knowledge v2** (frontmatter, `index.md` automático, `errors/`, `agents/`, notas automáticas, `profile.md` nos prompts) | Knowledge é PRIORIDADE; as métricas destravam Agent Board, stats, router por desempenho e auto-melhoria |
| **B: módulos CLI** | `guard` → `doctor` (+ oferecer baixar modelos, base do `setup`) → `pr` → `daily` → `release` → `test` · `fix` aprende erros recorrentes · personas criar/listar/remover | Segurança primeiro; cada um reaproveita os helpers do anterior |
| **C: Fase 5 (router)** | Gemini + Groq + fallback Ollama · escolha por desempenho · time de agentes formal (contexto isolado, dono único) | Precisa das métricas da onda A |
| **D: painéis** | `kvasir stats` + Agent Board + grafo do knowledge (mesma base HTML + Chart.js) | Precisa de métricas e de dados acumulados |
| **E: conversa** | `intent.ts` → proatividade → `kvasir watch` | Módulos estáveis antes de expor por linguagem natural |
| **F: memória e entrega** | OmniContext (MVP: `knowledge/` + `Doc/`) → `kvasir deploy` → `docs update` | O OmniContext vem depois do router e do knowledge |
| **G: autonomia** | Níveis de autonomia → auto-melhoria em branch → plugins | Exige testes automatizados (hoje não há nenhum) |
| **H: desktop e infra** | Widget (Electron × Tauri) · `setup`/.exe · sync · servidor 24h + Tailscale · Planner via Graph · task manager da empresa · LICENSE | O widget usa tudo o que vem antes |

---

## Onda A: o que mudou (commits `32590c8` → `6c7bcaa`)

Testes com USERPROFILE temporário (o `~/.kvasir` real não foi tocado) e modelos reais do Ollama.

| Item | Mudança | Resultado verificado |
|---|---|---|
| Conflito: `review/checks.ts` | Removido. Prompt com um id por linha adicionada (`L1…`) e veredito obrigatório por linha + exemplo; `utils/diff.ts` dá o número real da linha | qwen2.5-coder: de "nenhum problema" para achar off-by-one, chave no código, `console.log`, `fetch` sem tratamento, em 2 arquivos, com `arquivo:linha` certo. deepseek-r1 não serve para review (gasta tudo pensando) |
| Conflito: classificação do `fix` | `classifyError` voltou; complexo vai direto para `askFor('architect')` (timeout 300s) com arquivo, imports resolvidos (`utils/imports.ts`, entende `paths` do tsconfig com comentários), tsconfig, versões e "arquivos com o mesmo nome" para import que não resolve; simples que falha escala sozinho; clipboard com erro do tsc é usado sem perguntar | TS6137: zero perguntas. TS2307 (`@/utils/money` × `src/util/money.ts`): deepseek-r1 achou a causa (`utils` × `util`) só depois que o contexto ganhou os arquivos de mesmo nome |
| Métricas | `ai/metrics.ts` + `askOllamaDetailed` (tokens); `recordOutcome` em commit, branch, review, fix e doc; Claude registrado com tamanho e tempo | `kvasir models` mostra tempo, tokens e aprovação por tarefa × modelo e "4 idas ao Claude, ~2.300 tokens" para 2 tarefas |
| Knowledge v2 | `knowledge/notes.ts` (frontmatter, `index.md` gerado, `errors/`, `agents/`) + `auto.ts` (notas de fix, expansão, investigação útil, commit, task, branch, review útil, learn → agentes, doc) | Fluxo completo gerou `errors/ts6137.md`, `tasks/task-42.md`, `commits/kvr.md`, `patterns/review-kvr.md`, `agents/qwen2-5-coder.md` e o índice |
| `profile.md` vivo | Router injeta "Preferências aprendidas" em commit/branch/review/doc | Verificado: entra no commit, fica fora do fix |

### Pendências da onda A
- O caminho com um Claude real colado no chat continua simulado nos testes
- Detectar erro recorrente ("3º TS6137 esta semana") ficou para a onda B (os dados já estão em `errors/`)
- As notas antigas em `~/.kvasir/knowledge/libs/` (sem frontmatter) são lidas normalmente; ganham frontmatter quando o `doc` as atualizar

---

## Onda B: `guard` (commit `5c2b1da`)

Arquivos: `src/modules/guard/{index,rules,validators,allowlist}.ts`, `src/types/guard.ts`, `src/cli/guard.ts`; `utils/git.ts` ganhou `getStagedFiles` e `unstageFiles`; nova `AiTask 'guard'` (qwen2.5-coder → llama3.2); `commit --no-guard`.

**Testado** (repo descartável, dados de teste públicos):
- Validadores: Luhn, CPF e CNPJ com casos válidos, inválidos e todos-iguais ✅
- Regras: chave AWS de exemplo, senha atribuída, cartão 4111…, JWT 🔴; CPF e `console.log(token)` 🟡; `process.env`, `changeme` e telefone ignorados; `.env`, `.pem` e `google-services.json` 🔴, `.env.example` liberado
- IA (qwen2.5-coder): classificou uma string aleatória de 25 caracteres como segredo; `buildId` curto nem virou candidato
- `commit`: cancelar (stage intacto), tirar do stage (sobrou só `.env.example`, seguiu para a mensagem), ignorar com dupla confirmação + `.kvasirignore` (rodar de novo: limpo), `--no-guard`
- **Falha encontrada e corrigida no teste:** o `.kvasirignore` gravava o segredo em texto (`match:AKIA…`); agora grava `hash:`

**Pendências:** o `guard` ainda não roda como hook do git (`pre-commit`); só pelo `kvasir commit` ou `kvasir guard`.

---

## Onda B: `doctor` (commit `3c1c78f`)

Arquivos: `src/modules/doctor/index.ts` + `checks/{shared,node,git,mobile,ollama,kvasir}.ts`, `src/types/doctor.ts`, `src/cli/doctor.ts`.

**Testado:**
- Repo do kvasir: 13 ok, 3 avisos (sem `kvasir.context.md`, sem `profile.md`, sem `gh`); mobile pulado
- Projeto Expo descartável (`engines: >=20 <22`, `android/` sem `gradlew`): ❌ Node v24 fora do range, ⚠️ `JAVA_HOME` 17.0.17 × `java` do PATH 17.0.12, ❌ `gradlew` faltando, ⚠️ EAS 21.8.0 com versão nova, ✅ EAS logado
- Ollama simulado: só `qwen2.5-coder:7b` + `codellama` → avisos para `deepseek-r1`/`llama3.2` e ❌ "tarefa architect sem modelo"; fora do ar → ❌ com a dica
- **Bug encontrado e corrigido:** o `gh` aparecia ✅ sem estar instalado (a mensagem do Windows em português chega com acento quebrado); a detecção passou a usar o código de saída

**Pendência:** o download de modelos (`ollama pull`) não foi exercitado de verdade (são GBs; testei só a recusa).

**Correção posterior (no commit do `pr`):** a detecção "não instalado" não funcionava pelo código 9009 como eu tinha escrito: via `cmd /c` o código é 1, e o doctor só acertava porque o regex `reconhecido` sobrevivia ao acento quebrado. Agora `commandExists` usa `where`/`which`.

---

## Onda B: `pr` (commit `685f7bd`)

Arquivos: `src/modules/pr/{index,description}.ts`, `src/cli/pr.ts`; `utils/git.ts` ganhou `refExists`, `getCommitsSince`, `getDiffAgainst`, `getDiffStatAgainst`, `getChangedFilesAgainst`, `getUpstream`, `pushWithUpstream`; `ai/client.ts` ganhou `writeClipboard`; `utils/process.ts` ganhou `commandExists`; nova `AiTask 'pr'` (qwen2.5-coder → llama3.2, com preferências do `profile.md`).

**Testado** (repo descartável com `main`, `develop`, `feature/google-login`, 2 commits, um `.tsx` em `components/`, task ativa):
- Base sugerida `develop` (e `main` para `hotfix/`), tipo `feat`, tela detectada
- qwen2.5-coder real: título "feat: Adiciona login com Google", mudanças e passos de teste corretos na 1ª tentativa
- CLI: escolher base, gerar de novo (métricas: rejeitado → aprovado), copiar (clipboard com acentos certos)
- Criar: `gh` falso + `origin` local → `push -u` confirmado, `gh pr create --base develop --head feature/google-login --title … --body-file …`, temporário apagado, URL na nota `tasks/task-42.md`
- **Bug encontrado e corrigido:** a opção "Criar o PR" aparecia sem o `gh` instalado (detecção por código de saída errada; ver correção no doctor)

**Pendências:** não testei com o `gh` real (criaria um PR de verdade) nem a opção "editar" (abre editor externo).

---

## Onda B: `daily` (commit `b4ec48f`)

Arquivos: `src/modules/daily/{index,config,summary}.ts`, `src/cli/daily.ts`; `utils/git.ts` ganhou `isGitRepo`, `getRepoRoot`, `getGitConfigIn`, `getCommitsByAuthor`; nova `AiTask 'daily'` (llama3.2 → qwen2.5-coder); `~/.kvasir/config.json`.

**Testado:**
- Período: seg → sexta, ter → ontem, sáb → ontem (sexta), dom → sexta; `--since` repassado ao git
- 2 repos descartáveis: `app-loja` 3 commits (inclui o da branch `feature/profile`), `api-loja` 2; o commit do colega e o de 10 dias atrás ficaram de fora
- `--repos` salvou a lista em `config.json`; copiou a daily; nota em `knowledge/commits/daily.md`
- Prompt melhorado depois do 1º teste: "cart" virava "cartão" e sobrava " - " depois de `[repo]`; com exemplo de formato e "traduza o sentido" o llama3.2 escreveu "Corrigi o travamento ao abrir o carrinho vazio"

**Pendência:** o llama3.2 às vezes repete um assunto em dois itens; o usuário revisa antes de copiar (e "gerar de novo" fica registrado como rejeição nas métricas).

---

## Onda B: `release` (commit `ba2036f`)

Arquivos: `src/modules/release/{index,semver,changelog,versionFiles}.ts`, `src/cli/release.ts`; `utils/git.ts` ganhou `getLastTag`, `getCommitsWithBody`, `stageFiles`, `createAnnotatedTag`, `pushBranchWithTags`, `getChangedPaths`; nova `AiTask 'release'` (qwen2.5-coder → llama3.2).

**Testado:**
- `detectBump`: só chore/docs → nada; fix+perf → patch; feat → minor; `feat!` e rodapé `BREAKING CHANGE` → major
- Repo Expo descartável com `v1.4.2`: 1.5.0 sugerida, CHANGELOG com novidades/correções/outras, `package.json` com 4 espaços preservado, lock (raiz + `packages[""]`), `app.json` `versionCode` 7→8 e `buildNumber` "7"→"8", commit + tag anotada + `push --follow-tags` para remoto local
- Proteções: stage sujo → recusa; tag já existente → recusa sem alterar nada; nada novo desde a tag → avisa
- **Notas de release:** a 1ª versão do prompt (resumir com exemplo) fez o llama3.2 inventar itens e copiar o exemplo; virou "reescrever cada mudança que o usuário percebe"; comparei os dois modelos e o qwen2.5-coder ficou primeiro
- **Bugs encontrados e corrigidos no teste:** limpeza do "- -" comia a linha em branco e estragaria `**negrito**`

**Pendências:** `app.json` com objetos numa linha é reformatado em várias linhas (inofensivo); `app.config.js/ts` só gera aviso; versão 0.x com breaking sobe para 1.0.0 (como na especificação).

---

## Onda B: `test` (commit `c23372d`)

Arquivos: `src/modules/test/{index,framework,prompt}.ts`, `src/utils/testRunner.ts`, `src/cli/test.ts`; `listExports` foi para `utils/imports.ts` (o `doc --code` usa o mesmo); `getChangedPaths` passou a listar arquivos dentro de pastas novas (`--untracked-files=all`); nova `AiTask 'test'` (qwen2.5-coder → deepseek-r1).

**Testado com runners reais:**
- vitest 3: `cart.ts` → teste no estilo do `str.test.ts` existente, passou de primeira
- jest 29 + ts-jest: `slug.ts` passou de primeira em 2 de 2 rodadas (depois da linha de import pronta)
- Bug plantado (`average` dividindo por `length - 1`): detectado em 4 de 4 rodadas (2 vitest, 2 jest); o teste salvo passou 5/5 depois de corrigir o código
- Bordas: sem arquivos alterados, sem framework (dica de instalação), arquivo inexistente
- **Problemas achados e corrigidos pelo prompt (não por regra):** testes com `null`/`undefined` num `number[]`; `import default` para export nomeado seguido de um "bug" falso no código

**Pendências:** testes de componente com Testing Library não foram exercitados (o projeto de teste não tinha RN/React); a explicação do `BUG:` às vezes é confusa, mas vem com os valores errados como evidência.

---

## Onda B: erros recorrentes no `fix` e personas (commits `6f8d467`, `42b6a8f`)

**Recorrência no `fix`:** `recentErrorOccurrences` (`knowledge/auto.ts`) conta as ocorrências de um código em `knowledge/errors/<código>.md` nos últimos 7 dias. A partir da 3ª, o `fix` avisa ("🔁 Este é o 3º TS6137…", com arquivos de exemplo) e oferece investigar a causa comum com o `architect` (histórico + tsconfig + versões). Testado: TS6137 provocado 3 vezes → aviso na 3ª; deepseek-r1 real respondeu "importe do pacote, não de `@types/`".

**Personas:** `kvasir persona list/show/create/remove` (`modules/persona`), validação zod no `personaLoader`, `init` escolhe a persona e mantém a task ativa, `branch` e `commit` seguem a persona, `adapters/claude.ts` carrega a persona do projeto. Testado: criar `empresa-x` (prefixos `feat/ bug/ chore/`, português) copiando a persona embutida, JSON corrompido recusado, reset da embutida, nome repetido recusado, `init` gravando a persona no `kvasir.context.md` e no `CLAUDE.md`, qwen2.5-coder usando `bug/` e commit em português.

**Limite conhecido:** com persona em português, o qwen2.5-coder ainda escreve algumas branches em inglês (comparado com o llama3.2, que foi pior).

---

## Onda C: Gemini Flash e Groq (commit `45624ea`)

Arquivos: `src/ai/{gemini,groq,providers}.ts`, `src/utils/userConfig.ts` (config compartilhada; o `daily` passou a usar), `src/modules/doctor/checks/cloud.ts`; `router.ts` reescrito com candidatos (`CLOUD_MAP` + `MODEL_MAP`); métricas por provedor; `kvasir models --cloud on|off`.

**Testado com servidor falso** (imitando as duas APIs, chaves falsas, HOME temporário) e Ollama real:
- 1º uso com chave → pergunta o consentimento; "sim" → `commit` respondido pelo Groq, `daily` pelo Gemini
- `guard` e `architect` com nuvem permitida → 0 requisições à nuvem
- Groq 429 → Ollama respondeu; `pr` com Gemini 500 → Groq respondeu
- `--cloud off` → 0 requisições; consentimento "não" → grava `cloud: false` e usa o Ollama; sem chave → nem pergunta
- `kvasir models` mostra quem responde cada tarefa; `kvasir doctor` valida a chave (chave errada → "chave recusada (401)")
- Nenhuma chave aparece em métricas, config ou knowledge

**Pendências:** não testei com as APIs reais (não tenho as suas chaves e não devo vê-las); os nomes padrão de modelo (`gemini-2.5-flash`, `llama-3.3-70b-versatile`) podem mudar com o tempo: troque em `ai.geminiModel`/`ai.groqModel` no `config.json`. Falta, da onda C: escolher o modelo pelo desempenho medido e o time de agentes formal.

## Onda E3: `kvasir watch` também corrige erros de execução (2026-10-18)

Branch `feature/watch-runtime-errors`. Arquivos: `src/utils/runtimeErrors.ts` (parser), `src/modules/fix/runtime.ts` (correção + validação), `watch/index.ts` (`handleText`, `processRuntimeErrors`, provisórias), `findNewErrors`/`describeNewErrors` e regra de `catch` vazio em `fix/validate.ts`.
- **Leitura** (determinística): exceções e testes que falham, com os frames que apontam para arquivos do projeto: V8/Node (`at fn (arquivo:linha:col)`, `file:///`), Next (`webpack-internal:///`, `arquivo (l:c) @ fn`), Vitest (`AssertionError`), Jest (`expect(received)…` + Expected/Received), Metro/React (`in Cart (at Cart.tsx:12)`, nome resolvido se só um arquivo tem esse nome). node_modules, internos do Node e URLs de bundle ficam de fora; sem frame do projeto → ignorado. Erros iguais no mesmo lugar contam uma vez (assinatura)
- **Correção:** o modelo recebe o erro, o stack e o código de cada arquivo do stack (e, se o erro veio de um teste, os arquivos que o teste importa) e responde `ARQUIVO`/`LINHA`/linha corrigida, ou `NAO_DA`. Só pode mudar arquivo listado que não é teste
- **Validação:** (1) recusa mudar o teste para ele passar e esconder o erro (`any`, `@ts-ignore`, `catch` vazio, comentar/apagar); (2) nenhum erro de tipo novo no projeto (se for TypeScript); (3) se o erro veio de um teste, roda o teste de novo: passou = **confirmada** (aprovado nas métricas), falhou = desfaz e 2ª tentativa com o motivo; senão roda os testes do arquivo e a correção fica **provisória**
- **Provisória:** se o mesmo erro voltar enquanto o `watch` olha, o arquivo volta ao que era (só se ninguém mexeu depois), a chamada leva rejeição e a próxima tentativa recebe "o erro voltou depois desta correção". No fim, o `watch` lista as provisórias que ficaram (sem veredito nas métricas: não houve prova)
- Erros de tipo continuam primeiro: projeto que não compila não tem erro de execução útil

**Testado** (projeto descartável, Node 24 rodando .ts direto, Groq real): teste falhando por bug de cálculo → o modelo achou o bug no `cart.ts` importado pelo teste (não no teste), o teste rodou de novo e passou (confirmada); app quebrando (`cart.items.length` com `items` ausente) rodado a cada 4 s → `cart.items?.length ?? 0` provisória e o erro não voltou em 5 rodadas; respostas simuladas: correção na linha errada → o erro voltou na rodada seguinte, foi desfeita, e a 2ª tentativa (com o motivo no prompt) acertou; mudar o teste → recusado; `catch {}` → recusado; parser com 8 formatos (Node, file://, Next, Vitest, Jest, Metro, só bundle → ignorado, repetido → 1). Não testado: Next/Expo de verdade e o Vitest/Jest reais (usei um runner que imita a saída do Vitest).

## Atualizações do Dependabot (2026-10-20, branches `chore/zod-4` e `chore/node22-esm-deps`)

O Dependabot abriu 7 PRs logo que foi ligado. O CI só compila e roda `--help`, então cada major foi lido no changelog e testado de verdade (Node 24, Windows).

| PR | Decisão | Por quê |
|---|---|---|
| #14 zod 3 → 4 | ✅ aplicado em `chore/zod-4` (substitui o #14) | Continua com build CommonJS. Mesmo resultado do zod 3 para `kvasir.context.md` válido e inválido (mensagem com o que falta), personas válidas e inválidas (chave a mais ignorada como antes) e respostas do Planner (id numérico → texto, `status` padrão `?`, formato errado → erro). Só mudam os textos padrão do zod ("Too small: expected array to have >=1 items"). `{ message }` (deprecado no v4) virou `{ error }` |
| #11 commander 12 → 15 e #12 @inquirer/prompts 7 → 8 | ✅ aplicados juntos em `chore/node22-esm-deps` (substitui os dois) | Os dois só publicam ESM e exigem Node 22.12 / `^22.13.0`; no Node 18 do CI quebram (`ERR_REQUIRE_ESM`). O projeto continua CommonJS e carrega os dois por `require(esm)`, e o mínimo vai para Node 22.13 (18 e 20 já saíram de suporte; o `clipboardy` 5 já exigia 20). Ver `kvasir-decisions.md` |
| #13 axios 1.19 → 1.20 | ✅ pode mergear como está | Minor, CI verde |
| #8 actions/checkout 4 → 7, #9 actions/setup-node 4 → 7 | ✅ podem mergear como estão | As versões existem (o CI rodou com elas, verde nos 4 jobs) |
| #10 dev-dependencies | ❌ não mergear | TypeScript 7 (a versão nativa) removeu `moduleResolution: node` e `baseUrl`: o typecheck falha no `tsconfig.json`. Migrar é trabalho próprio (`moduleResolution` novo, `paths` relativos, conferir `tsc-alias` e o `ts-node` do `npm run dev`, que usa a API JS do TypeScript). `@types/node` 26 também não combina com o mínimo do `engines`: deveria seguir o Node 22 |

**Testado no commander 15 + inquirer 8** (comparando com o 12/7 no mesmo build): help de todos os 77 comandos e subcomandos igual (só a quebra de linha mudou); `keys status`, `persona list`, `persona show default`, `watch -- node -e …` (código 0 e 3, flags depois do segundo `--`), `watch node -e …` sem `--`, `stats --no-open --days 7`, `models --cloud maybe`, erro de digitação (`persna list` → sugestão), argumento obrigatório faltando; `--no-open` e `--no-guard` continuam `true` por padrão e `false` com a flag; todos os prompts do `@utils/prompt` com teclas simuladas (confirm sim/não, select com seta, input com valor e com padrão, checkbox, expand, password) e Ctrl+C ainda dá `ExitPromptError`. Não testado: `editor()` (abre o editor) e rodar no Node 22.13 em si (o CI cobre o carregamento: o `--help` importa todos os módulos).

**Mudança de comportamento:** commander 13+ recusa argumento a mais. `kvasir commit extra` antes ignorava o `extra` e seguia para o prompt do `git add .`; agora para com "too many arguments". Isso expôs um bug antigo: `kvasir knowledge search react hooks` buscava só "react" (e o intent separa a resposta do modelo por espaço); o `search` agora aceita a frase.

**Para o autor:** o ruleset da `main` exige o check `build (ubuntu-latest, node 18)`, que deixa de existir no PR do Node 22.13. Trocar no ruleset por `build (ubuntu-latest, node 22.13)` antes de mergear esse PR. Depois de mergear os PRs que substituem o #11, #12 e #14, fechar os três do Dependabot (ou ele fecha sozinho quando a versão chega na `main`).

**2ª rodada (2026-10-27, branch `chore/dependabot-cleanup`):** o #10 foi fechado sem `ignore` e voltou como #23 (TypeScript 7 de novo, CI vermelho). O `dependabot.yml` agora ignora major de `typescript` (6 e 7 removem `moduleResolution: node` e `baseUrl`; migrar é trabalho próprio) e de `@types/node` (segue o Node mínimo, 22). O #24 (cosmiconfig 10, que exige Node `^22.18`) mostrou que o `cosmiconfig` nem era usado: nenhum import em `src/`; foi removido das dependências. O #25 (fs-extra 11.4.1, patch) pode mergear como está.

## Configuração de projeto open source (2026-10-20, branch `chore/open-source-setup`)

A pedido do autor ("como é open source, tem que configurar as regras"). Antes não existia `.github/`: push direto na `main`, nada verificado, nenhum guia.
- **CI** (`.github/workflows/ci.yml`): em todo PR e push na `main`, `npm ci` → `typecheck` → `build` → `kvasir --help` em Ubuntu, Windows e macOS (Node 22) e Ubuntu com Node 18 (o `package.json` promete `>=18`)
- **Dependabot**: npm semanal (dev agrupadas), GitHub Actions mensal
- `CONTRIBUTING.md` (como rodar, regras do `CLAUDE.md`, commits, PRs), `SECURITY.md` (reporte privado; o que é sensível no Kvasir: chaves, código do usuário, execução sem aprovação), `CODE_OF_CONDUCT.md` (adota o Contributor Covenant 2.1, com resumo em português), `.github/CODEOWNERS`, templates de issue (bug, ideia; issue em branco desligada; link para o reporte privado) e de PR (checklist)
- **GitHub (feito e conferido pela API em 2026-10-20):** ruleset `main` ativo: `deletion`, `non_fast_forward`, `pull_request` (0 aprovações, só merge commit), `required_status_checks` (as 4 do CI); sem exceções. Reporte privado de vulnerabilidades ligado. Actions: CI de quem contribui pela 1ª vez espera aprovação; token do CI só lê. O GitHub pediu a senha do autor (modo sudo) para salvar o ruleset
- `CONTRIBUTING.md` detalha as regras da `main` e o caminho de uma contribuição de fora (fork → PR → aprovação do 1º CI → checagens → revisão → merge pelo mantenedor) e os PRs do Dependabot

## Onda F3: `kvasir docs update` (2026-10-20)

Arquivos: `src/modules/docs/{facts,sections,prompt,index}.ts`, `src/cli/docs.ts`; tarefa `docs` (dono: Documentador; nuvem: Gemini, local: qwen2.5-coder → llama3.2); git: `lastCommitTouching`, `getChangedFilesSince`, `getFileDiffSince`, `getFileAtRef`; `lineDiff`/`formatDiff` em `utils/diff.ts`.
- **Fatos pelo código:** ponto de partida = último commit que mexeu na documentação (README + pasta de docs) ou `--since <ref>`; arquivos de código mudados desde então (commitados ou não), diff de cada um, exports, exports que sumiram (comparando com a versão do ponto de partida), scripts novos/removidos do `package.json`. Por documento: o que ele **cita e não existe mais** e o que é **novo e ele não cita**
- Candidatos: README + `.md` da pasta de docs (fora os gerados `code/`, `libs/`, `CHANGELOG`) que citam algo que mudou (caminho, arquivo, export com cara de código, `npm run x`); você escolhe todos ou alguns
- **O Documentador só redige:** recebe os fatos, o documento (inteiro até 250 linhas; senão o índice + até 6 seções relevantes) e a lista "O QUE MUDAR NESTE DOCUMENTO", com exemplo do formato; responde por seção (`SEÇÃO: ## Título` + conteúdo). Parser linha a linha (blocos de código dentro da seção, bloco externo `ts`, `**SEÇÃO:**`, seção sem bloco)
- **Proteções do resultado:** título inexistente, seção maior do que o modelo viu ou proposta que apagaria subseções são ignorados com aviso; espaçamento e quebra de linha final preservados; histórico só ganha linha nova (com a data de hoje)
- Cada arquivo: diff colorido → aplicar / ver lado a lado no VS Code / pular; backup em `~/.kvasir/backups/docs`; o veredito vira métrica (`docs`). Agent Board mostra os documentos como jobs do Documentador

**Testado** (repositório descartável: `calcTotal` → `cartTotal`, `applyCoupon` novo, script `lint` novo): 1ª versão do prompt → o qwen local respondeu "NADA" nos dois documentos, apesar do diff; com os fatos por documento + lista de tarefas no fim + exemplo → README com o uso trocado para `cartTotal`/`applyCoupon` e `npm run lint` na tabela, `docs/api.md` com as duas funções e uma linha nova no histórico; seção inventada pelo modelo ("Scripts do package.json") barrada. O teste pegou 3 defeitos meus, corrigidos: bloco ```ts externo perdido, linha em branco após o título e quebra de linha final; e uma data inventada (agora vai a data de hoje). Com a documentação commitada, a 2ª execução diz "está em dia". Gemini estava com 503/timeout: o fallback local respondeu.

## Problemas conhecidos resolvidos (2026-10-20, branch `fix/known-issues`, saiu da `feature/omnicontext-f2`)

- **#1 `askFor`:** sem o passo "orquestrador"; o Claude valida só até o modelo provar que acerta. Testado com o Claude simulado e o qwen local: sem histórico → 1 ida ao clipboard; 6/6 aprovações → 0; `always` → 1; `never` → 0
- **#2** `kvasir models` agora mostra exatamente a ordem usada · **#7** `doc --code` em português · **#9** pasta de docs com a grafia real (`doc/folder.ts`) · **#8** `activeModules` do catálogo · **#10** `kvasir.context.md` validado com zod (testado: arquivo válido lido; campos apagados → erro listando "Branch rules → prefix…") · **#11** menu pós-branch e `-d` retestados (criar, listar, apagar mergeada, forçar não mergeada, voltar)
- Tabela "Status por bloco" acima reescrita com o estado real

## Onda F2, parte 2: fix, watch, review e test usando o contexto do projeto (2026-10-19)

Arquivos: `src/modules/omnicontext/context.ts` (`relatedContext`), `lineFixContextQuery` + `projectContext` em `fix/line.ts`, injeção em `fix/index.ts`, `fix/auto.ts`, `fix/runtime.ts`, `review/index.ts`, `test/index.ts` + `test/prompt.ts`; `kvasir index --watch`; `rag.context` no `config.json`.
- **`relatedContext(pergunta, { exclude, excludeFiles, limit })`**: busca no índice do projeto trechos de **código** (documentação fora) que o prompt ainda não mostra e devolve um bloco "Trechos de outros arquivos do projeto…", com uma linha "🧠 Contexto do projeto: …" no console. Sem índice, sem modelo de embeddings, Ollama fora ou `rag.context: false` → vazio, nunca erro
- **Índice sempre atual sem watcher:** antes de buscar, reindexa só o que mudou, no máximo a cada 30 s. `kvasir index --watch` reindexa 3 s depois da última mudança (ignora .git, node_modules, dist…)
- Onde entra: `fix` e `watch` (erro de tipo: erro + linha, sem repetir o trecho ±15 linhas já mostrado), `watch` de runtime (erro + linhas do stack, sem os arquivos já mostrados), `review` (linhas adicionadas, sem os arquivos do diff; "use só para conferir assinaturas, tipos e nomes"), `test` (exports + imports do arquivo testado, nos prompts de gerar e de corrigir)
- Dados do próprio Kvasir (`.kvasir/`, backups `*.kvasir-original.*`) nunca entram no índice

**Medido** (projeto descartável, só qwen2.5-coder local): `item.price` com a interface `CartItem { unitPriceCents… }` em outro arquivo (o erro TS2339 não dá pista). **Sem contexto**: errou nas 2 tentativas, validação desfez. **Com contexto**: o prompt trouxe `src/types/cart.ts` e corrigiu na 1ª (`item.unitPriceCents`), 1 → 0 erros. O teste pegou o índice puxando backups de `.kvasir/` (perfil de teste dentro do projeto): bloqueado. `index --watch`: arquivo novo e edição reindexados, node_modules ignorado. Não testado de ponta a ponta: `review` e `test` com contexto (só a injeção no prompt, que compila).

## Onda F2, parte 1: respostas do `ask` viram conhecimento (2026-10-19)

A pedido do autor ("isso passa para o nosso Obsidian e HTML?"). Antes: o knowledge era só fonte do `ask`; as respostas se perdiam.
- Resposta que **ajudou** ("A resposta ajudou?" = sim) vira nota em `knowledge/answers/<pergunta>.md` (nova categoria "Perguntas respondidas"): pergunta, resposta, fontes `arquivo:linha` e `Relacionado: [[…]]` para as notas do knowledge que ela usou. Resposta que não ajudou não é salva (não ensinar o errado). Mesma pergunta de novo substitui a nota
- O `ask` agora atualiza também o índice do knowledge (incremental), então respostas guardadas viram fonte das próximas perguntas; o `index.md` gerado do vault fica fora do índice
- Grafo (`knowledge show`): cor própria para respostas, ligadas às notas usadas. `kvasir stats`: card "Perguntas ao código" (quantas, quantas ajudaram) e "Perguntas respondidas recentes"

**Testado** (perfil temporário com a nota `libs/zod`, Ollama local): "para que o projeto usa o zod?" → resposta citando `knowledge/libs/zod.md` e `src/integrations/planner.ts` nas fontes, nota `answers/para-que-o-projeto-usa-o-zod.md` criada com `[[libs/zod]]`; grafo com a ligação; stats 1 pergunta / 1 ajudou. Pergunta parecida depois → a resposta guardada veio como 1ª fonte; com "não ajudou" nada foi salvo.

## Onda F1: OmniContext, busca local no código e nas anotações (2026-10-18)

Branch `feature/omnicontext` (saiu da main já com o PR #2). Arquivos: `src/rag/{files,chunker,keyword,store,index}.ts` (alias `@rag/*`), `src/ai/embeddings.ts`, `src/modules/omnicontext/index.ts`, `src/cli/omnicontext.ts`; tarefa `ask` no router (`CLOUD_MAP` vazio: só local) com dono Documentador.

**Decisão do banco (com números medidos nesta máquina):** o LanceDB funciona no Windows (busca de 20 mil pedaços em 36 ms), mas instala **677 MB** (302 MB só do binário nativo + onnxruntime/transformers opcionais) e não tem versão para Mac Intel. O índice próprio (vetores normalizados em int8 num arquivo binário, busca por força bruta) instala 0 MB e busca 20 mil pedaços em 16 ms, 100 mil em 73 ms e 200 mil em 145 ms. Padrão: índice próprio, atrás da interface `VectorStore`; Qdrant (servidor, via HTTP) fica como backend opcional futuro para índice compartilhado. Qdrant/Chroma como padrão foram descartados (precisam de servidor).

- **`kvasir index`**: projeto atual (raiz do git) + `~/.kvasir/knowledge` (`--no-knowledge` pula). Arquivos: `git ls-files` (respeita `.gitignore`) ou varredura; só texto/código até 200 KB; nunca o que o `guard` bloqueia (`.env`, chaves) e linhas com segredo viram "[linha removida: possível segredo]"
- Pedaços: código por declaração no topo do arquivo, markdown por título, o resto por janelas; 8–60 linhas com sobreposição. Embeddings `nomic-embed-text` (Ollama, com os prefixos `search_document:`/`search_query:`); o Kvasir pergunta antes de baixar (~274 MB)
- **Incremental** por hash do conteúdo; se o modelo de embeddings mudar, refaz do zero (vetores de modelos diferentes não se comparam). Índice em `~/.kvasir/index/<pasta>-<hash>/` (`meta.json`, `chunks.json`, `vectors.bin`)
- **`kvasir ask "pergunta"`** (`--all` busca em todas as pastas indexadas): atualiza o índice do que mudou, **reescreve a pergunta nos termos do código** (modelo local, em inglês), busca **híbrida** (vetores + BM25 com identificadores quebrados, fundidos por posição) com **vagas para código e para documentação**, responde só com os trechos citando `arquivo:linha`, mostra as fontes e **avisa se a resposta citar algo fora dos trechos**. "A resposta ajudou?" vira métrica
- Sem índice no projeto → oferece indexar na hora

**Testado** (repositório do Kvasir, perfil temporário): 152 arquivos / 718 pedaços em 15,7 s; 2ª vez 0,1 s (nada mudou); depois de editar 2 arquivos, o `ask` reindexou só os 2. Perguntas em português: antes da reescrita e do equilíbrio, só documentação voltava e o modelo inventou `performance.ts:12`; depois, as fontes trouxeram `router.ts`, `validate.ts`, `keys.ts` e nenhuma citação fora dos trechos; "como é calculado o frete?" → "não encontrei". Segredos: `.env`, `.pem` e pasta ignorada não entraram; a linha com chave `AIza…` foi removida e o resto do arquivo indexado. Não testado: projeto grande (dezenas de milhares de arquivos) e o menu interativo do `ask`.

## Onda E2: `kvasir watch` corrige e valida sozinho (2026-10-18)

Arquivos: `src/modules/watch/index.ts`, `src/cli/watch.ts`, `src/modules/fix/{auto,validate,backup,line}.ts` (o `fix/index.ts` foi dividido: backup/undo em `backup.ts`, regras + prompt + parser da linha em `line.ts`), `spawnCommand` em `utils/process.ts`, `knownFixesFor` em `knowledge/auto.ts`, `peekLastExecutorCall`/`recordOutcomeForCall` em `ai/metrics.ts`, `ai.autonomy` no `config.json`.
- **Entradas:** `kvasir watch` vigia o clipboard (copiou um erro do TypeScript → corrige); `kvasir watch -- npm run dev` (ou `tsc --watch`) roda o comando, repassa a saída e age quando a saída fica parada 1,5 s com erros
- **Por erro** (`fix/auto.ts`): só arquivo do projeto (nunca node_modules/dist/fora da pasta); espera o arquivo ficar 3 s parado; erro complexo (módulo, tsconfig) não é tocado (sugere `kvasir fix`); regra determinística ou IA (`askLocal`, com até 3 correções do mesmo código que já deram certo, do `knowledge/errors`)
- **Validação em camadas:** (1) recusa quem esconde o erro: `any`, `as unknown as`, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, `eslint-disable`, comentar ou apagar a linha (o prompt também pede isso); (2) typecheck do projeto inteiro antes × depois: o erro alvo some e nenhum erro novo aparece; (3) roda o teste do arquivo, se existir (`x.test.ts`, `__tests__/`); teste que já falhava antes não conta contra
- Falhou → desfaz na hora e faz a **2ª tentativa contando ao modelo** a linha recusada e o motivo; falhou de novo → arquivo como estava. Nunca escreve se o arquivo mudou desde a leitura
- **Cascata:** por rodada corrige o 1º erro de cada arquivo, revalida e repete com o que sobrou (até 5 rodadas); para depois de 3 tentativas no mesmo erro
- **Aprendizado sem você aprovar nada:** validação ok = aprovado, recusada = rejeitado (métricas → ranking da onda C); a chamada fica no manifesto do backup e `kvasir fix --undo` grava rejeição para ela; só o último veredito de cada chamada conta (`readMetrics`); correção validada vira nota em `knowledge/errors`
- Nunca commit, push nem instala pacote. `ai.autonomy: 1` mostra cada correção e pergunta; 2 (padrão) é sozinho. Agent Board mostra os erros como jobs do Revisor
- Também: a mensagem "📈 X responde primeiro…" só aparece quando o desempenho mudou a ordem

**Testado** (projeto TS descartável, Groq real): `watch -- tsc --watch` com 2 erros no mesmo arquivo → TS2552 (`formatPrise` → `formatPrice`) e TS2741 (faltava `quantity`) corrigidos e validados em rodadas, tsc 0 erros; `watch -- tsc --noEmit` (comando único) com erros em 2 arquivos; clipboard (simulado) → corrigiu; respostas simuladas para as falhas: `as any` recusado e 2ª tentativa certa; erro novo nas 2 tentativas → arquivo restaurado; quebrou o teste (runner falso) → recusado e 2ª certa; linha comentada → recusada; o 2º prompt sempre trouxe o motivo; `--undo` restaurou e gravou rejeição para as mesmas chamadas (aprovação final 0/2). Pego no teste: `passThroughOptions` derrubava o CLI inteiro (removido). Não testado: dev server real (Next/Expo) e clipboard real.

## Onda E1: perguntas proativas com autonomia que cresce com a confiança (2026-10-18)

Plano da onda E combinado com o autor: E1 sugestões proativas; E2 `kvasir watch` que **corrige e valida sozinho** (validação em camadas: todos os erros antes × depois, testes do arquivo mexido, recusa de correção que só esconde o erro como `any`/`@ts-ignore`/apagar código; 2ª tentativa mostrando ao modelo o erro novo; reaproveita soluções do `knowledge/errors`; espera o arquivo ficar parado e o dev server recompilar; corrige o 1º erro da cascata e revalida; desfaz sozinho se piorar; resultado da validação vira aprovação/rejeição nas métricas; nunca commit/push/instalar; para após 3 tentativas no mesmo erro; `ai.autonomy` 1 pergunta / 2 padrão); E3 erros de runtime.

Arquivos E1: `src/modules/proactive/{index,suggestions,settings}.ts`, `src/cli/proactive.ts`, `countChangedLines`/`parseAddedDependencies` em `utils/diff.ts`, `getLocalBranchAges`/`countUnmergedCommits` em `utils/git.ts`; estado em `~/.kvasir/proactive.json`.
- 4 sugestões, decididas por código (sem IA): **branch da task** (task ativa e você na main/master/develop: no `commit` e no `start`) · **review antes do commit** (≥ 80 linhas alteradas e esse diff ainda não revisado; o `review` grava o hash do diff) · **documentar lib nova** (dependência nova no `package.json` staged sem nota em `knowledge/libs`, depois do commit; `@types/*` fora) · **branch parada** (≥ 14 dias sem commit, no `start`; diz se já foi mergeada; apaga só com `-d`, nunca força)
- No máximo **uma sugestão por comando**. Respostas: Sim / Agora não / Não perguntar mais sobre "X" / Nunca mais sugerir
- **Confiança:** ≥ 5 respostas com ≥ 90% de "sim" → oferece fazer sozinho (uma vez); ≤ 20% → para de sugerir e avisa. Ações que mexem no git (branch da task, apagar branch) nunca ficam automáticas
- `kvasir proactive`: tabela (modo, aceitas, recusadas, automáticas, "não perguntar") e ajuste de cada uma; mudar o modo zera o histórico

**Testado** (perfil temporário + repositório descartável): 5 "sim" no review → ofereceu automático → 6ª vez rodou sozinho; 2ª sugestão no mesmo comando bloqueada; 5 "não" em lib nova → parou e avisou; branch parada não mergeada → "não perguntar desta" lembrado; branch mergeada → apagada; branch da task na main perguntada; `zod` oferecido e `@types/node` ignorado; review não sugerido para diff já revisado nem para diff pequeno; tabela do `kvasir proactive`. Não testado: dentro do `commit` de verdade (usa o Claude via clipboard).

## Onda D: `kvasir stats`, Agent Board e grafo do knowledge (2026-10-18)

Arquivos: `src/ai/jobs.ts` (estado ao vivo em `~/.kvasir/metrics/board.json`: `queueJobs`, `startJob`, `switchJobModel`, `finishJob`, `clearQueuedJobs`; jobs de processos mortos ou com mais de 30 min somem), `src/modules/stats/{data,html,report,index}.ts`, `src/cli/stats.ts` (`stats`, `board`), `src/modules/knowledge/graph.ts`, `listAllNotes` em `notes.ts`, `openInDefaultApp` em `utils/process.ts`, campo `title` nas métricas.
- **`kvasir stats [--days N] [--watch] [--no-open]`** → `~/.kvasir/reports/stats.html`: cards (chamadas, aprovação, tempo, tokens, % nuvem, idas ao Claude), radar (commit, branch, fix, review, doc, task: últimos 7 dias × média semanal de 30), barras por dia (ok × falhou), tabela modelo × tarefa, "o que aprendeu" (notas por pasta, erros recentes, preferências do `profile.md`).
- **Agent Board** (seção do stats; `kvasir board` = stats ao vivo, recarrega a cada 3 s e abre no board): um quadro por agente com A fazer / Em andamento (ao vivo) / Feito / Falhou (7 dias), "mais usado" e "rendeu melhor". O router abre um job a cada chamada; `doc --code` e a expansão do `fix` enfileiram os arquivos antes ("a fazer").
- **`kvasir knowledge show`** também gera `~/.kvasir/reports/knowledge.html`: grafo de notas e `[[links]]` (força dirigida em canvas), cores por pasta, busca, clique mostra a nota, "ligar por tags", zoom/arrastar, a tela se ajusta sozinha.
- Tudo offline: sem CDN (não usei Chart.js para funcionar sem internet e nada sair da máquina); texto dos dados só via `textContent`; JSON embutido com `<` e U+2028/2029 escapados.

**Testado:** perfil temporário com 30 dias de métricas sintéticas, 8 notas com links e jobs ao vivo; as duas páginas abertas no navegador (cards, radar, barras, board com 2 a fazer + 2 em andamento, grafo com 8 notas/5 links, clique na nota, ligar por tags). Com os dados reais: `stats`, `knowledge show` e `board` (refresh no modo ao vivo, sem refresh no normal), `--days 0` recusado. Não testado: abrir o navegador sozinho (`explorer.exe`/`open`/`xdg-open`) no seu PC.

### Time de agentes formal (2026-10-18): fim da onda C

`src/ai/agents.ts` (`AGENTS`, `TASK_OWNER`, `agentForTask`, `tasksOf`), `buildAgentPrompt` no router (papel + preferências + prompt), `agents.<nome>.{models,cloud}` no `config.json`, campo `agent` nas métricas, `kvasir agents` / `agents list` / `agents set` (+ submenu no menu), `kvasir models` mostra o agente de cada tarefa e respeita as trocas, `kvasir learn` grava `knowledge/agents/<agente>.md`.

**Testado:** `kvasir agents list` real; commit de verdade (diff do commit do menu) pelo Groq com o papel de Executor → `feat(menu): add interactive menu with intent detection`; com `agents.executor = { models: [llama3.2], cloud: false }` → respondeu o llama3.2 local e a métrica gravou `agent: executor`; `agents set` com respostas simuladas (trocar modelos, nuvem off/on, voltar ao padrão, agente inexistente, Arquiteto sem opção de nuvem); notas `agents/executor.md` e `agents/revisor.md` geradas. As notas antigas por modelo (`agents/<modelo>.md`) continuam no vault, sem atualização.

### Escolha de modelo pelo desempenho (2026-10-18)

`src/ai/performance.ts` (`rankCandidates`), `rankedCandidates` no router (usado por `askFor`, `askLocal` e `kvasir models`). Pausa de 15 min após 3 falhas seguidas; reordena só quem tem ≥ 3 avaliações ou ≥ 5 chamadas, por aprovação × sucesso (Laplace), empate → mais rápido. O Claude no `askFor` recebe a lista ordenada com os motivos. O `Entendi:` do interpretador registra aprovação/rejeição (`intent`).

**Testado:** 6 cenários sintéticos (sem dados → padrão; Groq rejeitado × qwen aprovado → qwen primeiro; 3 falhas há 5 min → Groq por último; há 1 h → volta; só um com dados → não pula ninguém; outra tarefa não conta); integração: métricas favorecendo llama3.2 em `intent` → "📈 llama3.2 responde primeiro" e respondeu; `kvasir models` com as métricas reais (tudo "ordem padrão", ainda sem uso).

### Menu, frase livre e pré-requisitos encadeados (2026-10-18)

A pedido do autor ("não quero ter que saber o comando"). `src/modules/menu/{catalog,intent,index}.ts`, `src/modules/init/ensure.ts` (`loadContext` que oferece o `init`), `AiTask` `intent` (Groq → qwen2.5-coder/llama3.2), `keys status`.
- `kvasir` → menu · `kvasir keys|persona|knowledge` → submenu · `kvasir comit` → sugere `commit` · `kvasir quero salvar minha chave do groq` → `keys set groq` (confirma antes)
- `task` → oferece `branch`; `knowledge` vazio → oferece `add`; `models --cloud on` sem chave → oferece `keys set`; qualquer runner sem `kvasir.context.md` → oferece `init`

**Testado:** menu/submenu/argumento com respostas simuladas; Groq real: 9 frases → comando certo (inclusive "nenhum" para "faz um bolo"), ~250–550 ms; só Ollama: acertou keys, push ("manda pro repo", depois de exemplo no prompt), branch, doctor, daily, undo, keys remove, pr; errou "joga isso no remoto" (oferece o menu). Oferta do `init` testada num projeto sem contexto. Não testado: o menu num terminal real (só respostas simuladas).

### `kvasir keys` (2026-10-18)

A pedido do autor: um comando para salvar a chave sem digitar `setx`. `kvasir keys` (status), `keys set [gemini|groq]` (link → cola oculta → testa na API → confirma → grava como variável de ambiente do usuário → oferece ligar a nuvem), `keys remove`. Arquivos: `src/utils/userEnv.ts`, `src/modules/keys/index.ts`, `src/cli/keys.ts`, `CLOUD_KEY_INFO` em `providers.ts`, `checkCloudKey` no router, `password()` em `@utils/prompt`. `getGeminiApiKey`/`getGroqApiKey` também leem o valor salvo (funciona sem reabrir o terminal). `doctor` e `models` sugerem `kvasir keys set`.

**Testado:** API Groq falsa (chave aceita → salva e pergunta a nuvem; recusada 401 → pergunta se salva mesmo assim; prefixo `AIza` no Groq → avisa); registro real do Windows (grava, processo novo lê, remove, nada sobrou); valor com aspas/`;` recusado. Não testado: macOS/Linux.

**Teste real com as chaves do autor (2026-10-18):** `keys set` funcionou nos dois. Achados e correções:
- Google gera chaves `AQ.` desde 2026 (antes `AIza`): o aviso de prefixo estava errado → aceita os dois; o `guard` ganhou as regras `google-auth-key` (`AQ.`) e `groq-api-key` (`gsk_`), testadas com chaves falsas
- Os modelos padrão davam 404 (aposentados): Gemini → `gemini-flash-latest` (alias que o Google mantém atualizado; hoje aponta para o gemini-3.8-flash); Groq → `qwen/qwen3.8-27b` (`llama-3.3-70b-versatile` saiu do catálogo). Um 404 agora diz para trocar `ai.geminiModel`/`ai.groqModel`
- O Gemini 3.x pensa antes de responder e o raciocínio consumia o `maxOutputTokens` (resposta vazia, MAX_TOKENS): pede `thinkingBudget: 0` e soma 1024 tokens de folga
- Chamadas reais pelo router: commit e pr respondidos pelo Groq (~0,3–4s); daily, doc e release pelo Gemini (~4–5s); 503/429 do Gemini (sobrecarga e limite por minuto do plano grátis) caíram no Groq/Ollama como esperado

---

## Kvasir genérico: persona da empresa fora do repositório

O projeto é open source: a persona da empresa do autor e os templates de `CLAUDE.md` dela saíram de `src/`. Antes disso foram guardados na máquina do autor (`~/.kvasir/templates/` e `~/.kvasir/personas/`, com o campo `match` para continuar sendo detectada; backup do JSON antigo em `.bak`).

- Embutida agora só a `default` (`src/personas/default.ts`): Git Flow + Conventional Commits em inglês
- `match` (opcional) na persona substitui a regra fixa "nome do pacote contém a sigla da empresa"; `findPersonaForPackage` no `init`
- Templates: `~/.kvasir/templates/<persona>-<mobile|web>.md`, de qualquer persona
- O build não copia mais templates para `dist/`
- `kvasir-architecture.md` da raiz (visão antiga com nomes de projetos reais) saiu do git e foi para o `.gitignore`; o arquivo continua no disco
- **Histórico do git reescrito (2026-10-17, a pedido do autor):** os arquivos da persona e o documento antigo saíram de todos os commits; o nome da empresa e os nomes de projetos reais viraram exemplos genéricos ("ACME", `acme-web-app`…); a linha `Co-Authored-By` do primeiro commit da Fase 2 saiu junto. A árvore final ficou idêntica. `main` e a branch foram atualizadas no GitHub com force push (`--force-with-lease`). **Todos os IDs de commit mudaram** (os citados neste arquivo já são os novos). Clones antigos (outros PCs) precisam ser clonados de novo. Backup do histórico antigo: `kvasir-backup-antes-de-limpar-historico.bundle` no Desktop do autor (contém a persona antiga: guardar em local privado e apagar quando não precisar mais).

---

## Decisões tomadas nesta sessão
- `fix` aplica a correção do arquivo do erro **sem perguntar** (pedido explícito do usuário). Continua fazendo backup e abrindo o diff, e a opção de desfazer fica disponível
- Nenhum `shell: true`: comandos `.cmd` no Windows (`npm`, `npx`, `code`) passam por `cmd.exe /d /s /c` com argumentos escapados; o typecheck roda o `tsc` do projeto direto pelo `node`
