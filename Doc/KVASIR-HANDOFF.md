# Kvasir: handoff

> Passagem de bastão entre sessões. Atualizado no fim de cada fase.
> Branch de trabalho: `fix/kvasir-fix-and-editor`

## Plano

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Análise de `src/` | ✅ concluída (2026-10-17) |
| 2 | Correções: `fix`, menu pós-commit, remover `shell: true`, prompts do Ollama | ✅ concluída (2026-10-17) |
| 3 | Testar `review`, `task`, `start`, `learn`, `knowledge` | ✅ concluída (2026-10-17) |
| 4 | Mapa de novos módulos (só listar, aguardar aprovação da ordem) | 🟡 mapa entregue, aguardando aprovação da ordem |
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

## Fase 4: mapa de novos módulos (de `Doc/ideas/novos-modulos.md` + `omnicontext.md`)

Fase 3 commitada em `da5c29b`. **Nada implementado: aguardando o usuário aprovar a ordem.**

| # sugerido | Módulo | O que faz | Depende de | Esforço |
|---|---|---|---|---|
| 1 | `guard` | Bloqueia segredos, arquivos proibidos e dados pessoais no diff staged; integrado ao `commit` | `getDiff` (existe), regras do `review/checks.ts` (reaproveitar), validadores novos (Luhn, CPF, CNPJ, entropia), IA opcional (`askLocal`) | Médio |
| 2 | `doctor` | Diagnóstico do ambiente: Node, Git, JDK/Android/Expo/EAS, Ollama + modelos, `~/.kvasir`, `gh` | `runCommand` (existe), `listInstalledModels` + `MODEL_MAP` (existem); sem IA | Baixo |
| 3 | `pr` | Título e descrição do PR em português; copia ou cria com `gh pr create` | `getDiffStat` (existe), `getBaseBranch`/`getCommitsSince` (novos), `AiTask 'pr'` novo, `writeClipboard` (expor), `gh` (opcional, checado pelo `doctor`) | Médio |
| 4 | `daily` | Resumo "ontem / hoje / impedimentos" dos commits, pronto para colar | `git log --author --since` (novo), task ativa (existe), config de repositórios em `~/.kvasir/config` (novo; `cosmiconfig` já é dependência), IA para português (`llama3.2`), clipboard | Baixo/médio |
| 5 | `release` | SemVer pelos Conventional Commits, `CHANGELOG.md`, versão no `package.json`/`app.json`, commit + tag | Tags git, `createTag` (novo), escrita de JSON; IA só opcional (notas); passo do EAS Update depende do futuro `kvasir deploy` | Médio |
| 6 | `test` | Gera testes dos arquivos alterados, roda e corrige até 3 vezes | Detecção Jest/Vitest/RTL, `AiTask 'test'`, `runCommand` para rodar, laço de correção no estilo do `fix`, testes existentes como exemplo | Alto |
| 7 | OmniContext (`index` / `ask`) | RAG local: indexa `knowledge/` e `Doc/`, responde citando arquivos; depois watchers, PDFs, repositórios e sync Win↔Mac | **Fase 5 (router)**, `nomic-embed-text` no Ollama, banco vetorial (Qdrant/Chroma, infra nova), `chokidar`; decisão Tauri × Electron antes do app | Alto |

Motivo da ordem: segurança primeiro (`guard`); `doctor` é barato e checa o que os próximos usam (`gh`, Ollama); `pr`/`daily`/`release` reaproveitam os helpers do git em sequência; `test` é o mais arriscado; OmniContext depende da Fase 5.

---

## Decisões tomadas nesta sessão
- `fix` aplica a correção do arquivo do erro **sem perguntar** (pedido explícito do usuário). Continua fazendo backup e abrindo o diff, e a opção de desfazer fica disponível
- Nenhum `shell: true`: comandos `.cmd` no Windows (`npm`, `npx`, `code`) passam por `cmd.exe /d /s /c` com argumentos escapados; o typecheck roda o `tsc` do projeto direto pelo `node`
