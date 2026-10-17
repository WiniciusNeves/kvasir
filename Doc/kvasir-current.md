# Kvasir: estado atual

> Atualizado em: 2026-10-17 · versão `0.1.0`
> Feito a partir da leitura do código em `src/`. Atualize quando um módulo mudar de status.

---

## Status dos comandos

| Comando | Status | Observação |
|---|---|---|
| `init` | ✅ funcionando | Detecta ACME (nome contém `acme`) e a stack, gera contexto e os 3 adapters |
| `commit` | ✅ funcionando | Prompt novo (stat + diff limitado), aviso se fugir do padrão; menu pós-commit em loop testado (log → undo encerra o menu) |
| `branch` | ✅ funcionando | Inclui `-l`, `-d` e o menu pós-branch |
| `doc <lib>` | ✅ funcionando | npm → fallback GitHub |
| `doc --code` | ✅ funcionando | Seleção por pasta já implementada (o bug dos 391 arquivos foi resolvido) |
| `models` | ✅ funcionando | |
| `fix` | ✅ funcionando | Lê o erro do clipboard (ou roda o typecheck), corrige o arquivo do erro sem perguntar (regra determinística → IA), abre o diff no VS Code, conta os erros iguais e pergunta se corrige os outros; `--undo` restaura. Testado ponta a ponta com TS6137 e com qwen2.5-coder (TS2551, TS2322) |
| `review` | 🧪 falta testar | Prompt novo em português; pergunta "As sugestões foram úteis?" (não aplica nada) |
| `push` / `undo` / `log` | 🧪 falta testar | Também acessíveis pelo menu do `commit` |
| `format` | 🧪 falta testar | Sem `execSync` (usa `runCommand`) |
| `knowledge` | 🧪 falta testar | |
| `learn` | 🧪 falta testar | |
| `task` / `start` | 🧪 falta testar | Dependem de `KVASIR_PLANNER_API_URL`; sem ela, retornam lista vazia |

---

## Infraestrutura

- Node.js >= 18 + TypeScript strict, compilado com `tsc` + `tsc-alias`; o build copia `src/personas/templates` para `dist/`
- `npm link` deixa o comando `kvasir` global
- Ollama em `http://localhost:11434` (`num_ctx` 8192, timeout 120s, nomes de modelo casados com as tags instaladas), com os modelos `codellama`, `qwen2.5-coder`, `llama3.2` e `deepseek-r1`
- Claude acessado via clipboard (`clipboardy`), sem API key; a resposta é lida de volta do clipboard (funciona com várias linhas)
- Nenhum `shell: true`/`exec`/`execSync`: comandos `.cmd` no Windows passam por `runCommand` (`utils/process.ts`)
- Dependências: commander, @inquirer/prompts, axios, clipboardy, fs-extra, cosmiconfig, zod

---

## Problemas conhecidos

Encontrados na leitura do código. Estão em ordem de impacto.

| # | Problema | Onde | Sugestão |
|---|---|---|---|
| 1 | Cada `askFor` exige **2 idas ao clipboard** (Claude escolhe o modelo + Claude valida). Um `commit` simples vira copiar/colar duas vezes | `src/ai/router.ts` | Escolher o modelo pelo `MODEL_MAP` (primeiro instalado) por padrão, deixar validação opcional (`--validate`) ou só para `fix`/`architect` |
| 2 | `kvasir models` mostra o "modelo ativo" como o primeiro instalado, mas quem decide na prática é o Claude no passo de orquestração | `models/index.ts` × `router.ts` | Se resolver o #1, os dois passam a bater |
| 3 | ✅ resolvido (2026-10-17): a pergunta virou "As sugestões foram úteis?" | `review/index.ts` | — |
| 4 | Task ativa nunca é gravada: `task` só mostra a task, e `branch` não usa task | `task`, `branch`, `contextWriter` | `task` grava em `kvasir.context.md` → `branch` sugere o nome a partir dela |
| 5 | ✅ resolvido (2026-10-17): `format` usa `runCommand` | `format/index.ts` | — |
| 6 | ✅ resolvido (2026-10-17): `doc --code` usa `askLocal('doc')` (llama3.2) | `doc/code.ts` | — |
| 7 | Mensagens em inglês em `init`, `knowledge`, `task`, `start`, `learn`, `format` e `doc --code` (regra: interface em português) | vários | Traduzir |
| 8 | `activeModules` fixo em `init` e sem `review`, `knowledge` e outros | `init/index.ts` | Gerar a partir dos comandos registrados |
| 9 | Pasta de saída é `DOC/` (maiúsculo), mas este repo usa `Doc/`. No Windows é a mesma pasta; no Mac/Linux são diferentes | `doc/` | Padronizar um nome |
| 10 | `kvasir.context.md` é parseado com regex; se o formato mudar à mão, quebra em silêncio | `contextWriter.ts` | Validar com `zod` (já é dependência) |
| 11 | `branch`: o menu pós-branch e `-d` ainda não foram retestados depois que os helpers do git passaram a conferir o `status` | `branch/index.ts` | Testar na Fase 3 |

---

## Ainda não implementado

- Gemini Flash e Groq no router (só Ollama + Claude via clipboard)
- `kvasir task update`
- `profile.md` usado nos prompts (o `learn` atualiza, mas nenhum módulo lê)
- Knowledge base usada nos prompts (o `doc` escreve, mas `fix`/`review` não leem)
- Testes automatizados
