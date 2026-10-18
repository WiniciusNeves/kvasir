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
| 4.B | Onda B: guard → doctor → pr → daily → release → test, fix aprende erros recorrentes, personas | ✅ concluída (2026-10-17): `guard` (`c550d50`), `doctor` (`4fa36a2`), `pr` (`c487239`), `daily` (`c030292`), `release` (`299220a`), `test` (`bad5560`), recorrência no `fix` (`a53cd89`), personas (`9c4551b`) |
| 4.C | Onda C (Fase 5): Gemini + Groq + fallback Ollama, escolha por desempenho, time de agentes formal | 🔧 em andamento: Gemini + Groq + fallback ✅ (`3da3e69`); falta: escolha por desempenho, time de agentes formal |
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

Fase 2 commitada em `42ee7d0`. Os testes da Fase 3 rodaram com `USERPROFILE` temporário (não tocam o `~/.kvasir` real) e um repositório git temporário; o Claude foi simulado colocando a resposta no clipboard. (Os testes da Fase 2 tinham gravado 4 linhas de feedback no `~/.kvasir` real; foram removidas.)

| Módulo | O que quebrou | Correção | Resultado |
|---|---|---|---|
| `review` | qwen2.5-coder não viu um `<=` fora do array, repetiu o mesmo item 10x e inventou "falta tipo" | `review/checks.ts`: checagens determinísticas nas linhas adicionadas (segredo, `<= .length`, `any`, `console.log`, `debugger`) com nº da linha; prompt com o que já foi achado; `repeat_penalty` 1.2 + `maxTokens` 700; itens sem duplicata, máx. 10 | Os 3 problemas achados com a linha exata; a IA respondeu "Nenhum problema encontrado." em vez de inventar |
| `task` | Erro cru do axios (`status code 401`); dizia "rode kvasir branch para vincular a task", mas nada era gravado; resposta da API sem validação | Mensagens em português; zod valida `{ id, title, status }`; confirmação grava `## Active task` (`setActiveTask`, só essa seção) | Testado com Planner falso: lista, escolhe, grava |
| `start` | `ECONNREFUSED` abortava o resumo do dia | Falha do Planner vira aviso; resumo segue até "Pronto para trabalhar" | ok com e sem API, com servidor fora e com token errado |
| `branch` | Não usava a task | Descrição pré-preenchida com a task ativa; branch criada é gravada em `linked branch` | Testado: `feature/google-login` vinculada a `ACME-42` |
| `learn` | Salvava a frase "Aqui está…" e as cercas ``` dentro do `profile.md`; prompt em inglês; feedback sem limite | `extractProfile`; prompt em português; últimos 150 registros | `profile.md` salvo limpo; sem feedback, mensagem clara |
| `knowledge` | Título com `/` e `:` criava subpasta + **stream NTFS**: a nota sumia do `show`/`search`; sobrescrevia sem avisar; conteúdo de 1 linha; `link` duplicava | Nome seguro `[a-z0-9-]`; pergunta antes de substituir; conteúdo pelo clipboard; link sem duplicar; `search` mostra a linha | add/show/search/link ok |
| `doc <lib>` | (achado junto) `@tanstack/react-query` criaria subpasta `@tanstack/` | `toLibFileName` → `tanstack__react-query.md` | — |

Todos os textos desses módulos estão em português. Sobra inglês só em `init` e `doc --code` (#7).

### Pendências
- `push` contra um remoto real, `format` e o menu do `branch` não foram testados
- O caminho interativo com um Claude real (colar no chat) não foi testado; o clipboard foi simulado

---

## Fase 4: mapa completo (fonte: `Doc/ideas/backlog.md`, backlog v2)

Fase 3 commitada em `da5c29b`. Status conferido no `src/` em 2026-10-17. **Nada implementado: aguardando o usuário aprovar a ordem.**
Legenda: ✅ existe · 🟡 parcial · ❌ falta · Esforço: B (baixo) · M (médio) · A (alto)

### ⚠️ Conflitos com os princípios no que já foi feito (corrigir primeiro)
| O quê | Princípio | Proposta |
|---|---|---|
| `review/checks.ts` (Fase 3): regex para `<= .length`, `any` e `console.log` compensam a IA que errou | "Nunca contornar IA com regra fixa" | Mover só as regras de **segredo** para o `guard` (lá são determinísticas por especificação) e tirar as outras; melhorar o review pelo prompt/contexto (linhas numeradas, exemplos do feedback, deepseek-r1 para bugs) |
| `fix` (Fase 2): a classificação simples × complexo foi removida; a investigação só roda se a troca de linha falhar, e **pergunta** antes | Bloco 8 + "corrige direto sem perguntar sim/não" | Voltar a classificar; complexo → deepseek-r1 investiga direto, lendo arquivos relacionados e o `tsconfig` |
| `askFor` manda o prompt inteiro ao Claude 2 vezes (escolher modelo + validar) | "Zero token desperdiçado" | Escolha determinística pelo desempenho registrado; Claude valida só quando vale (Fase 5) |
| Soluções do `fix`/`review` não são salvas | "Conhecimento gerado fica salvo" | Notas automáticas em `knowledge/errors/` (bloco 1) |

### Status por bloco
| Bloco | Item | Status | Depende de | Esforço |
|---|---|---|---|---|
| **1 Knowledge (PRIORIDADE)** | Pastas `libs/ patterns/ decisions/ tasks/ commits/` | ✅ | — | — |
| | Pastas `errors/` e `agents/` | ❌ | — | B |
| | Links `[[nota]]` (`link`, `doc` "Usado em") | ✅ | — | — |
| | Frontmatter (tags, projeto, data, origem) | ❌ | — | B |
| | `index.md` automático | ❌ (o `show` só lê se existir) | frontmatter | B |
| | Notas automáticas | 🟡 só o `doc` grava em `libs/`; falta `fix`, `commit`, `task`, `review`, `learn` | frontmatter | M |
| | `search/add/link/show` | ✅ básico (corrigido na Fase 3) | — | — |
| | `show` como grafo HTML | ❌ | infra HTML do bloco 5/10 | M |
| | Sync entre PCs | ❌ | bloco 13 | B |
| | `profile.md` usado nos prompts | ❌ (o `learn` grava, ninguém lê) | — | B |
| **2 OmniContext** | `src/rag/`, `index`/`ask`, embeddings, banco vetorial, watchers, PDFs, sync LAN, contexto 256k | ❌ tudo | bloco 1 + Fase 5 + `nomic-embed-text` + Qdrant/Chroma + `chokidar` | A |
| **3 Novos módulos** | `guard` | ❌ (regex de segredo existe no `review/checks.ts`) | diff staged ✅ | M |
| | `doctor` | ❌ | `runCommand` ✅, `listInstalledModels` ✅ | B |
| | `pr` | ❌ | helpers de git (base, commits), `gh` opcional | M |
| | `daily` | ❌ | `git log --author`, task ativa ✅, config de repos | B/M |
| | `release` | ❌ | tags, `createTag`, `package.json`/`app.json` | M |
| | `test` | ❌ | detecção Jest/Vitest, laço de correção do `fix` | A |
| **4 Time de agentes** | Papéis Arquiteto/Revisor/Executor no `MODEL_MAP` | 🟡 (Documentador sem Gemini; não há Testador) | Fase 5 | B |
| | Claude orquestra e valida | ✅ (`askFor`) | — | — |
| | Contexto isolado por agente, dono único da tarefa | ❌ (não existe a abstração "agente") | métricas | M |
| | Avaliar agentes extras (claude, codex, opencode, hermes, cline, copilot, qwen, openclaw) | ❌ | métricas | M |
| **5 Agent Board** | Kanban por agente, dono único, métricas (chamadas, tokens, tempo, aprovação, erros), "em que cada IA é melhor", HTML dark + Chart.js | ❌ tudo; **hoje nenhuma métrica é registrada** (o Ollama devolve `eval_count`/`total_duration`, e o código ignora) | métricas no router | A |
| **6 AI Router** | Gemini Flash + Groq + fallback Ollama | ❌ | chaves gratuitas | M |
| | Mapa por tarefa | 🟡 só Ollama | — | — |
| | Escolha por desempenho | ❌ | métricas | M |
| | Detecta modelos instalados | ✅ (Fase 2) | — | — |
| | Oferece baixar o que falta | ❌ | `ollama pull` via `runCommand` | B |
| | `kvasir models` | 🟡 (o "ativo" não bate com a escolha do Claude) | — | B |
| | Claude chefe via clipboard | ✅ | — | — |
| **7 Intenção** | `src/ai/intent.ts`, seguras direto / destrutivas confirmam, texto agora / voz depois | ❌ | módulos estáveis | M |
| **8 `fix` inteligente** | Corrige sem perguntar + oferece expandir | ✅ | — | — |
| | Classificação simples × complexo | 🟡 (removida na Fase 2, ver conflitos) | — | B |
| | Complexo: deepseek-r1 lê arquivos relacionados e config | 🟡 investiga, mas só com o texto do erro | — | M |
| | Diff no VS Code + backup + `--undo` | ✅ | — | — |
| | Aprende erros recorrentes ("3º TS6137 esta semana") | ❌ | `knowledge/errors/` | B/M |
| **9 Aprendizado** | Feedback aprovado/rejeitado | ✅ | — | — |
| | `learn` → `profile.md` vivo | 🟡 grava, mas nenhum prompt usa | — | B |
| | Perguntas proativas (commit sem review, lib sem doc, branch parada, erro repetido) | ❌ | métricas + knowledge | M |
| | `kvasir watch` (terminal/clipboard) | ❌ | intenção | M |
| **10 Stats e deploy** | `kvasir stats` (radar, semana × mês, cards, barras, "o que aprendeu") | ❌ | métricas + feedback | M |
| | `kvasir deploy` (EAS Build/Submit/Update; Vercel) | ❌ | `doctor`, `release` | A |
| **11 Desktop** | Widget, wake word, Whisper, TTS, ver a tela, estados do robô | ❌ tudo; Electron × Tauri pendente | CLI estável + router + intenção | A |
| **12 Auto-melhoria** | Níveis de autonomia (perguntar / seguro sozinho / autônomo em branch) | ❌ (hoje: confirm em tudo, exceto `fix`) | config | B/M |
| | Detecta módulo fraco → patch em `chore/self-improve-*` → build + testes → relatório | ❌ | métricas + testes automatizados (não existem) | A |
| | Plugins (`plugin install/create`, sugestão por uso) | ❌ | API de módulos estável | A |
| **13 Infra/produto** | Repositório no GitHub | ✅ (`origin` = WiniciusNeves/kvasir) | — | — |
| | `kvasir setup` (detecta Node/Git/Ollama, baixa modelos, cria `~/.kvasir`), .exe/Docker | ❌ | `doctor` | M |
| | `~/.kvasir` sincronizado, servidor 24h + Tailscale | ❌ (infra, quase sem código) | — | B |
| | Contexto entre Claudes via `CLAUDE.md`/`kvasir.context.md` | ✅ (adapters) | — | — |
| | Personas: criar/listar/remover | 🟡 só ACME; `loadPersona`/`savePersona` existem, sem comando | — | B |
| | Open source: LICENSE | ❌ (repo sem LICENSE) | decisão do usuário | B |
| **14 Tarefas** | Planner | 🟡 GET genérico com Bearer, testado com servidor falso; **Microsoft Planner real usa Graph API + OAuth**, não integrado | conta Microsoft | M |
| | Task manager da ACME | ❌ | API da ACME | M |
| | Task ativa ↔ branch ↔ contexto | ✅ (Fase 3) | — | — |
| | `kvasir start` | ✅ | — | — |
| | `kvasir docs update` | ❌ | knowledge + `doc --code` | M |

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
| **H: desktop e infra** | Widget (Electron × Tauri) · `setup`/.exe · sync · servidor 24h + Tailscale · Planner via Graph · task manager ACME · LICENSE | O widget usa tudo o que vem antes |

---

## Onda A: o que mudou (commits `47ce5c3` → `0d1d905`)

Testes com USERPROFILE temporário (o `~/.kvasir` real não foi tocado) e modelos reais do Ollama.

| Item | Mudança | Resultado verificado |
|---|---|---|
| Conflito: `review/checks.ts` | Removido. Prompt com um id por linha adicionada (`L1…`) e veredito obrigatório por linha + exemplo; `utils/diff.ts` dá o número real da linha | qwen2.5-coder: de "nenhum problema" para achar off-by-one, chave no código, `console.log`, `fetch` sem tratamento, em 2 arquivos, com `arquivo:linha` certo. deepseek-r1 não serve para review (gasta tudo pensando) |
| Conflito: classificação do `fix` | `classifyError` voltou; complexo vai direto para `askFor('architect')` (timeout 300s) com arquivo, imports resolvidos (`utils/imports.ts`, entende `paths` do tsconfig com comentários), tsconfig, versões e "arquivos com o mesmo nome" para import que não resolve; simples que falha escala sozinho; clipboard com erro do tsc é usado sem perguntar | TS6137: zero perguntas. TS2307 (`@/utils/money` × `src/util/money.ts`): deepseek-r1 achou a causa (`utils` × `util`) só depois que o contexto ganhou os arquivos de mesmo nome |
| Métricas | `ai/metrics.ts` + `askOllamaDetailed` (tokens); `recordOutcome` em commit, branch, review, fix e doc; Claude registrado com tamanho e tempo | `kvasir models` mostra tempo, tokens e aprovação por tarefa × modelo e "4 idas ao Claude, ~2.300 tokens" para 2 tarefas |
| Knowledge v2 | `knowledge/notes.ts` (frontmatter, `index.md` gerado, `errors/`, `agents/`) + `auto.ts` (notas de fix, expansão, investigação útil, commit, task, branch, review útil, learn → agentes, doc) | Fluxo completo gerou `errors/ts6137.md`, `tasks/acme-42.md`, `commits/kvr.md`, `patterns/review-kvr.md`, `agents/qwen2-5-coder.md` e o índice |
| `profile.md` vivo | Router injeta "Preferências aprendidas" em commit/branch/review/doc | Verificado: entra no commit, fica fora do fix |

### Pendências da onda A
- O caminho com um Claude real colado no chat continua simulado nos testes
- Detectar erro recorrente ("3º TS6137 esta semana") ficou para a onda B (os dados já estão em `errors/`)
- As notas antigas em `~/.kvasir/knowledge/libs/` (sem frontmatter) são lidas normalmente; ganham frontmatter quando o `doc` as atualizar

---

## Onda B: `guard` (commit `c550d50`)

Arquivos: `src/modules/guard/{index,rules,validators,allowlist}.ts`, `src/types/guard.ts`, `src/cli/guard.ts`; `utils/git.ts` ganhou `getStagedFiles` e `unstageFiles`; nova `AiTask 'guard'` (qwen2.5-coder → llama3.2); `commit --no-guard`.

**Testado** (repo descartável, dados de teste públicos):
- Validadores: Luhn, CPF e CNPJ com casos válidos, inválidos e todos-iguais ✅
- Regras: chave AWS de exemplo, senha atribuída, cartão 4111…, JWT 🔴; CPF e `console.log(token)` 🟡; `process.env`, `changeme` e telefone ignorados; `.env`, `.pem` e `google-services.json` 🔴, `.env.example` liberado
- IA (qwen2.5-coder): classificou uma string aleatória de 25 caracteres como segredo; `buildId` curto nem virou candidato
- `commit`: cancelar (stage intacto), tirar do stage (sobrou só `.env.example`, seguiu para a mensagem), ignorar com dupla confirmação + `.kvasirignore` (rodar de novo: limpo), `--no-guard`
- **Falha encontrada e corrigida no teste:** o `.kvasirignore` gravava o segredo em texto (`match:AKIA…`); agora grava `hash:`

**Pendências:** o `guard` ainda não roda como hook do git (`pre-commit`); só pelo `kvasir commit` ou `kvasir guard`.

---

## Onda B: `doctor` (commit `4fa36a2`)

Arquivos: `src/modules/doctor/index.ts` + `checks/{shared,node,git,mobile,ollama,kvasir}.ts`, `src/types/doctor.ts`, `src/cli/doctor.ts`.

**Testado:**
- Repo do kvasir: 13 ok, 3 avisos (sem `kvasir.context.md`, sem `profile.md`, sem `gh`); mobile pulado
- Projeto Expo descartável (`engines: >=20 <22`, `android/` sem `gradlew`): ❌ Node v24 fora do range, ⚠️ `JAVA_HOME` 17.0.17 × `java` do PATH 17.0.12, ❌ `gradlew` faltando, ⚠️ EAS 21.8.0 com versão nova, ✅ EAS logado
- Ollama simulado: só `qwen2.5-coder:7b` + `codellama` → avisos para `deepseek-r1`/`llama3.2` e ❌ "tarefa architect sem modelo"; fora do ar → ❌ com a dica
- **Bug encontrado e corrigido:** o `gh` aparecia ✅ sem estar instalado (a mensagem do Windows em português chega com acento quebrado); a detecção passou a usar o código de saída

**Pendência:** o download de modelos (`ollama pull`) não foi exercitado de verdade (são GBs; testei só a recusa).

**Correção posterior (no commit do `pr`):** a detecção "não instalado" não funcionava pelo código 9009 como eu tinha escrito: via `cmd /c` o código é 1, e o doctor só acertava porque o regex `reconhecido` sobrevivia ao acento quebrado. Agora `commandExists` usa `where`/`which`.

---

## Onda B: `pr` (commit `c487239`)

Arquivos: `src/modules/pr/{index,description}.ts`, `src/cli/pr.ts`; `utils/git.ts` ganhou `refExists`, `getCommitsSince`, `getDiffAgainst`, `getDiffStatAgainst`, `getChangedFilesAgainst`, `getUpstream`, `pushWithUpstream`; `ai/client.ts` ganhou `writeClipboard`; `utils/process.ts` ganhou `commandExists`; nova `AiTask 'pr'` (qwen2.5-coder → llama3.2, com preferências do `profile.md`).

**Testado** (repo descartável com `main`, `develop`, `feature/google-login`, 2 commits, um `.tsx` em `components/`, task ativa):
- Base sugerida `develop` (e `main` para `hotfix/`), tipo `feat`, tela detectada
- qwen2.5-coder real: título "feat: Adiciona login com Google", mudanças e passos de teste corretos na 1ª tentativa
- CLI: escolher base, gerar de novo (métricas: rejeitado → aprovado), copiar (clipboard com acentos certos)
- Criar: `gh` falso + `origin` local → `push -u` confirmado, `gh pr create --base develop --head feature/google-login --title … --body-file …`, temporário apagado, URL na nota `tasks/acme-42.md`
- **Bug encontrado e corrigido:** a opção "Criar o PR" aparecia sem o `gh` instalado (detecção por código de saída errada; ver correção no doctor)

**Pendências:** não testei com o `gh` real (criaria um PR de verdade) nem a opção "editar" (abre editor externo).

---

## Onda B: `daily` (commit `c030292`)

Arquivos: `src/modules/daily/{index,config,summary}.ts`, `src/cli/daily.ts`; `utils/git.ts` ganhou `isGitRepo`, `getRepoRoot`, `getGitConfigIn`, `getCommitsByAuthor`; nova `AiTask 'daily'` (llama3.2 → qwen2.5-coder); `~/.kvasir/config.json`.

**Testado:**
- Período: seg → sexta, ter → ontem, sáb → ontem (sexta), dom → sexta; `--since` repassado ao git
- 2 repos descartáveis: `app-acme` 3 commits (inclui o da branch `feature/profile`), `api-acme` 2; o commit do colega e o de 10 dias atrás ficaram de fora
- `--repos` salvou a lista em `config.json`; copiou a daily; nota em `knowledge/commits/daily.md`
- Prompt melhorado depois do 1º teste: "cart" virava "cartão" e sobrava " - " depois de `[repo]`; com exemplo de formato e "traduza o sentido" o llama3.2 escreveu "Corrigi o travamento ao abrir o carrinho vazio"

**Pendência:** o llama3.2 às vezes repete um assunto em dois itens; o usuário revisa antes de copiar (e "gerar de novo" fica registrado como rejeição nas métricas).

---

## Onda B: `release` (commit `299220a`)

Arquivos: `src/modules/release/{index,semver,changelog,versionFiles}.ts`, `src/cli/release.ts`; `utils/git.ts` ganhou `getLastTag`, `getCommitsWithBody`, `stageFiles`, `createAnnotatedTag`, `pushBranchWithTags`, `getChangedPaths`; nova `AiTask 'release'` (qwen2.5-coder → llama3.2).

**Testado:**
- `detectBump`: só chore/docs → nada; fix+perf → patch; feat → minor; `feat!` e rodapé `BREAKING CHANGE` → major
- Repo Expo descartável com `v1.4.2`: 1.5.0 sugerida, CHANGELOG com novidades/correções/outras, `package.json` com 4 espaços preservado, lock (raiz + `packages[""]`), `app.json` `versionCode` 7→8 e `buildNumber` "7"→"8", commit + tag anotada + `push --follow-tags` para remoto local
- Proteções: stage sujo → recusa; tag já existente → recusa sem alterar nada; nada novo desde a tag → avisa
- **Notas de release:** a 1ª versão do prompt (resumir com exemplo) fez o llama3.2 inventar itens e copiar o exemplo; virou "reescrever cada mudança que o usuário percebe"; comparei os dois modelos e o qwen2.5-coder ficou primeiro
- **Bugs encontrados e corrigidos no teste:** limpeza do "- -" comia a linha em branco e estragaria `**negrito**`

**Pendências:** `app.json` com objetos numa linha é reformatado em várias linhas (inofensivo); `app.config.js/ts` só gera aviso; versão 0.x com breaking sobe para 1.0.0 (como na especificação).

---

## Onda B: `test` (commit `bad5560`)

Arquivos: `src/modules/test/{index,framework,prompt}.ts`, `src/utils/testRunner.ts`, `src/cli/test.ts`; `listExports` foi para `utils/imports.ts` (o `doc --code` usa o mesmo); `getChangedPaths` passou a listar arquivos dentro de pastas novas (`--untracked-files=all`); nova `AiTask 'test'` (qwen2.5-coder → deepseek-r1).

**Testado com runners reais:**
- vitest 3: `cart.ts` → teste no estilo do `str.test.ts` existente, passou de primeira
- jest 29 + ts-jest: `slug.ts` passou de primeira em 2 de 2 rodadas (depois da linha de import pronta)
- Bug plantado (`average` dividindo por `length - 1`): detectado em 4 de 4 rodadas (2 vitest, 2 jest); o teste salvo passou 5/5 depois de corrigir o código
- Bordas: sem arquivos alterados, sem framework (dica de instalação), arquivo inexistente
- **Problemas achados e corrigidos pelo prompt (não por regra):** testes com `null`/`undefined` num `number[]`; `import default` para export nomeado seguido de um "bug" falso no código

**Pendências:** testes de componente com Testing Library não foram exercitados (o projeto de teste não tinha RN/React); a explicação do `BUG:` às vezes é confusa, mas vem com os valores errados como evidência.

---

## Onda B: erros recorrentes no `fix` e personas (commits `a53cd89`, `9c4551b`)

**Recorrência no `fix`:** `recentErrorOccurrences` (`knowledge/auto.ts`) conta as ocorrências de um código em `knowledge/errors/<código>.md` nos últimos 7 dias. A partir da 3ª, o `fix` avisa ("🔁 Este é o 3º TS6137…", com arquivos de exemplo) e oferece investigar a causa comum com o `architect` (histórico + tsconfig + versões). Testado: TS6137 provocado 3 vezes → aviso na 3ª; deepseek-r1 real respondeu "importe do pacote, não de `@types/`".

**Personas:** `kvasir persona list/show/create/remove` (`modules/persona`), validação zod no `personaLoader`, `init` escolhe a persona e mantém a task ativa, `branch` e `commit` seguem a persona, `adapters/claude.ts` carrega a persona do projeto. Testado: criar `empresa-x` (prefixos `feat/ bug/ chore/`, português) copiando a ACME, JSON corrompido recusado, reset da embutida, nome repetido recusado, `init` gravando a persona no `kvasir.context.md` e no `CLAUDE.md`, qwen2.5-coder usando `bug/` e commit em português.

**Limite conhecido:** com persona em português, o qwen2.5-coder ainda escreve algumas branches em inglês (comparado com o llama3.2, que foi pior).

---

## Onda C: Gemini Flash e Groq (commit `3da3e69`)

Arquivos: `src/ai/{gemini,groq,providers}.ts`, `src/utils/userConfig.ts` (config compartilhada; o `daily` passou a usar), `src/modules/doctor/checks/cloud.ts`; `router.ts` reescrito com candidatos (`CLOUD_MAP` + `MODEL_MAP`); métricas por provedor; `kvasir models --cloud on|off`.

**Testado com servidor falso** (imitando as duas APIs, chaves falsas, HOME temporário) e Ollama real:
- 1º uso com chave → pergunta o consentimento; "sim" → `commit` respondido pelo Groq, `daily` pelo Gemini
- `guard` e `architect` com nuvem permitida → 0 requisições à nuvem
- Groq 429 → Ollama respondeu; `pr` com Gemini 500 → Groq respondeu
- `--cloud off` → 0 requisições; consentimento "não" → grava `cloud: false` e usa o Ollama; sem chave → nem pergunta
- `kvasir models` mostra quem responde cada tarefa; `kvasir doctor` valida a chave (chave errada → "chave recusada (401)")
- Nenhuma chave aparece em métricas, config ou knowledge

**Pendências:** não testei com as APIs reais (não tenho as suas chaves e não devo vê-las); os nomes padrão de modelo (`gemini-2.5-flash`, `llama-3.3-70b-versatile`) podem mudar com o tempo: troque em `ai.geminiModel`/`ai.groqModel` no `config.json`. Falta, da onda C: escolher o modelo pelo desempenho medido e o time de agentes formal.

---

## Decisões tomadas nesta sessão
- `fix` aplica a correção do arquivo do erro **sem perguntar** (pedido explícito do usuário). Continua fazendo backup e abrindo o diff, e a opção de desfazer fica disponível
- Nenhum `shell: true`: comandos `.cmd` no Windows (`npm`, `npx`, `code`) passam por `cmd.exe /d /s /c` com argumentos escapados; o typecheck roda o `tsc` do projeto direto pelo `node`
