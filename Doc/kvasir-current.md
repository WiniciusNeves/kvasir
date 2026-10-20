# Kvasir: estado atual

> Atualizado em: 2026-10-17 · versão `0.1.0`
> Feito a partir da leitura do código em `src/`. Atualize quando um módulo mudar de status.

---

## Status dos comandos

| Comando | Status | Observação |
|---|---|---|
| `init` | ✅ funcionando | Escolhe a persona (a detectada primeiro), mantém a task ativa ao rodar de novo, mensagens em português |
| `persona` | ✅ testado (2026-10-17) | list/show/create/remove; JSON validado com zod; a persona do projeto define prefixos/idioma de branch e idioma de commit |
| `commit` | ✅ funcionando | Roda o `guard` antes (`--no-guard` pula); prompt com stat + diff limitado; menu pós-commit em loop |
| `pr` | ✅ testado (2026-10-17) | Base pelo Git Flow, fatos por código (tipo, tela, task, commits), IA escreve só o texto; copiar, criar com `gh` (com `push -u`), editar, gerar de novo. qwen2.5-coder gerou um PR bom na 1ª tentativa; criação testada com `gh` falso e remoto local |
| `daily` | ✅ testado (2026-10-17) | 2 repos descartáveis: pegou só os commits do autor (inclusive em branch de feature), ignorou o do colega e o antigo; llama3.2 escreve o "Ontem" com exemplo de formato; copia e salva em `knowledge/commits/daily.md` |
| `release` | ✅ testado (2026-10-17) | Repo Expo descartável: v1.4.2 → 1.5.0 (feat), CHANGELOG agrupado, indentação preservada, `versionCode`/`buildNumber` +1, commit + tag + push para remoto local; recusa stage sujo, tag repetida e "nada novo"; notas reescrevem só o que o usuário percebe |
| `test` | ✅ testado (2026-10-17) | vitest e jest reais: testes passando de primeira em `cart.ts` e `slug.ts`; bug plantado (média dividindo por `length - 1`) detectado em 4 de 4 rodadas, com o teste salvo passando depois da correção |
| `doctor` | ✅ testado (2026-10-17) | Testado no repo do kvasir e num projeto Expo descartável: pegou Node fora do `engines`, `JAVA_HOME` ≠ `java` do PATH, `gradlew` faltando, EAS desatualizado, `gh` ausente; Ollama com modelo faltando/fora do ar simulado |
| `guard` | ✅ testado (2026-10-17) | Regras determinísticas (chaves AWS, Google `AIza`/`AQ.`, Groq `gsk_`, GitHub, Stripe, JWT, senhas, cartão Luhn 🔴; CPF/CNPJ, logs sensíveis 🟡), arquivos proibidos, IA para strings de alta entropia; cancelar / tirar do stage / ignorar com dupla confirmação; `.kvasirignore` com hashes |
| `branch` | ✅ funcionando | Inclui `-l`, `-d` e o menu pós-branch |
| `doc <lib>` | ✅ funcionando | npm → fallback GitHub |
| `doc --code` | ✅ funcionando | Seleção por pasta já implementada (o bug dos 391 arquivos foi resolvido) |
| menu / intenção | ✅ testado (2026-10-18) | `kvasir` sozinho abre o menu; submenus de keys/persona/knowledge; erro de digitação sugere o comando; frase livre vira comando (Groq: 9 de 9 frases certas; só Ollama: errou gírias como "joga isso no remoto" e aí oferece o menu); comandos oferecem rodar o pré-requisito na hora |
| `watch` | ✅ testado (2026-10-18) | Corrige sozinho erros do TypeScript e de execução (exceções e testes que falham: Node, Next, Vitest, Jest, Metro), pelo clipboard ou `kvasir watch -- <comando>`. Validação: não aceita esconder o erro nem mudar o teste, não cria erro de tipo novo, roda o teste de novo (confirmada) ou fica provisória e é desfeita se o erro voltar; aprende com o resultado e com o `fix --undo` |
| `index` / `ask` | ✅ testado (2026-10-18) | OmniContext: busca local (embeddings no Ollama, índice próprio sem dependências) no projeto, no `Doc/` e no knowledge; incremental; `ask` responde citando `arquivo:linha`, com busca híbrida, pergunta reescrita nos termos do código e aviso de citação inventada. Segredos e `.gitignore` ficam de fora. Resposta que ajudou vira nota em `knowledge/answers/` (grafo e `stats`) e é reaproveitada nas próximas perguntas. `fix`, `watch`, `review` e `test` recebem trechos de código relacionados do índice (medido: com contexto o qwen local corrigiu na 1ª um erro que sem contexto não corrigia); `index --watch` reindexa ao salvar |
| `proactive` | ✅ testado (2026-10-18) | 4 sugestões (branch da task, review antes do commit, documentar lib nova, branch parada), uma por comando; viram automáticas ou param conforme as suas respostas; `kvasir proactive` mostra e ajusta |
| `stats` / `board` | ✅ testado (2026-10-18) | HTML offline em `~/.kvasir/reports/`: cards, radar, barras por dia, modelos, o que aprendeu e o Agent Board (a fazer / em andamento ao vivo, feito / falhou); `board` atualiza a cada 3 s |
| `agents` | ✅ testado (2026-10-18) | Time formal: 5 agentes, dono único por tarefa, prompt de papel, modelos trocáveis por agente (`agents set`), nuvem desligável por agente; métricas e notas no knowledge por agente |
| `keys` | ✅ testado (2026-10-18) | Salva/remove a chave do Gemini/Groq como variável de ambiente do usuário; testa na API antes; nunca mostra a chave. Testado com API falsa (chave aceita, recusada, prefixo errado) e registro real do Windows (gravar, ler em processo novo, remover) |
| `models` | ✅ funcionando | Mostra a ordem real de cada tarefa (com o motivo: padrão, desempenho ou pausa) e o desempenho real por tarefa × modelo (métricas) e o custo das idas ao Claude |
| `fix` | ✅ funcionando | Clipboard com erro do tsc é usado direto; classifica simples × complexo; simples corrige sem perguntar (regra comprovada → IA); complexo investiga a causa raiz com imports, tsconfig, versões e arquivos de mesmo nome; nota em `knowledge/errors/`; expansão e `--undo` |
| `review` | ✅ testado (2026-10-17) | Veredito da IA linha por linha (sem regras fixas); achados com `arquivo:linha`; reviews úteis viram nota em `knowledge/patterns/` |
| `push` / `undo` / `log` | 🧪 falta testar | Também acessíveis pelo menu do `commit` |
| `format` | 🧪 falta testar | Sem `execSync` (usa `runCommand`) |
| `knowledge` | ✅ v2 (2026-10-17) · grafo HTML no `show` (2026-10-18) | Vault do Obsidian com frontmatter e `index.md` gerado; pastas `errors/` e `agents/`; notas automáticas de fix, commit, task, branch, review, learn e doc |
| `learn` | ✅ testado (2026-10-17) | Prompt em português, últimos 150 feedbacks, salva só o markdown (antes salvava a frase do Claude e as cercas ```) |
| `task` / `start` | ✅ testado (2026-10-17) | Testados sem a API e com um Planner falso: erros claros (token, conexão, formato via zod); `task` grava a task ativa; `start` não aborta se o Planner falhar |

---

## Infraestrutura

- Node.js >= 18 + TypeScript strict, compilado com `tsc` + `tsc-alias`
- `npm link` deixa o comando `kvasir` global
- Ollama em `http://localhost:11434` (`num_ctx` 8192, timeout 120s, nomes de modelo casados com as tags instaladas), com os modelos `codellama`, `qwen2.5-coder`, `llama3.2` e `deepseek-r1`
- Claude acessado via clipboard (`clipboardy`), sem API key; a resposta é lida de volta do clipboard (funciona com várias linhas)
- IA na nuvem opcional: Gemini Flash (textos em português) e Groq (código), opt-in, com fallback para o Ollama; `guard` sempre local; chaves salvas com `kvasir keys`
- Métricas de toda chamada de IA em `~/.kvasir/metrics/calls.jsonl` (tempo, tokens, aprovação)
- `profile.md` injetado nos prompts de commit, branch, review e doc
- Nenhum `shell: true`/`exec`/`execSync`: comandos `.cmd` no Windows passam por `runCommand` (`utils/process.ts`)
- Dependências: commander, @inquirer/prompts, axios, clipboardy, fs-extra, cosmiconfig, zod (usado no planner)

---

## Problemas conhecidos

Encontrados na leitura do código. Estão em ordem de impacto.

| # | Problema | Onde | Sugestão |
|---|---|---|---|
| 1 | Cada `askFor` exige **2 idas ao clipboard** (Claude escolhe o modelo + Claude valida). Um `commit` simples vira copiar/colar duas vezes | `src/ai/router.ts` | Escolher o modelo pelo `MODEL_MAP` (primeiro instalado) por padrão, deixar validação opcional (`--validate`) ou só para `fix`/`architect` |
| 2 | `kvasir models` mostra o "modelo ativo" como o primeiro instalado, mas quem decide na prática é o Claude no passo de orquestração | `models/index.ts` × `router.ts` | Se resolver o #1, os dois passam a bater |
| 3 | ✅ resolvido (2026-10-17): a pergunta virou "As sugestões foram úteis?" | `review/index.ts` | — |
| 4 | ✅ resolvido (2026-10-17): `task` grava a task ativa (`setActiveTask`) e o `branch` usa e vincula a branch | `task`, `branch`, `contextWriter` | — |
| 5 | ✅ resolvido (2026-10-17): `format` usa `runCommand` | `format/index.ts` | — |
| 6 | ✅ resolvido (2026-10-17): `doc --code` usa `askLocal('doc')` (llama3.2) | `doc/code.ts` | — |
| 7 | Mensagens em inglês só no `doc --code` (o resto foi traduzido em 2026-10-17) | `doc/code.ts` | Traduzir |
| 8 | `activeModules` ainda é uma lista fixa no `init` (atualizada em 2026-10-17 com todos os módulos) | `init/index.ts` | Gerar a partir dos comandos registrados |
| 9 | Pasta de saída é `DOC/` (maiúsculo), mas este repo usa `Doc/`. No Windows é a mesma pasta; no Mac/Linux são diferentes | `doc/` | Padronizar um nome |
| 10 | `kvasir.context.md` é parseado com regex; se o formato mudar à mão, quebra em silêncio | `contextWriter.ts` | Validar com `zod` (já é dependência) |
| 11 | `branch`: o menu pós-branch e `-d` não foram retestados depois que os helpers do git passaram a conferir o `status` (a criação com task ativa foi testada) | `branch/index.ts` | Testar |

---

## Ainda não implementado

- `kvasir task update`
- `kvasir task` sem `KVASIR_PLANNER_API_URL` não tem fonte de tasks local (só a API)
- Knowledge base consultada nos prompts (hoje os módulos escrevem notas, mas nenhum lê; vem com o OmniContext)
- Testes automatizados do próprio Kvasir (o `kvasir test` gera testes para os projetos, mas o repo do Kvasir ainda não tem os seus)
