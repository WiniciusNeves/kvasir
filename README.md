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

| Comando | O que faz | Status |
|---|---|---|
| `kvasir init` | Detecta o projeto (deps do `package.json`), aplica a persona e gera `kvasir.context.md`, `CLAUDE.md`, `.github/copilot-instructions.md` e `.cursor/rules` | ✅ |
| `kvasir commit` | Roda o `guard`, lê o diff staged e sugere uma mensagem Conventional Commits em inglês; depois mostra um menu (push, undo, log, merge). `--no-guard` pula a checagem | ✅ |
| `kvasir guard` | Procura segredos (chaves AWS/Google/GitHub/Stripe, JWT, senhas), arquivos proibidos (`.env`, chaves, Firebase) e dados pessoais (cartão, CPF, CNPJ) no stage; strings aleatórias suspeitas vão para a IA. Exceções em `.kvasirignore` | ✅ |
| `kvasir branch` | Descreve a tarefa e ele gera o nome da branch no Git Flow. `-l` lista, `-d` deleta | ✅ |
| `kvasir doc <lib>` | Busca o README no npm/GitHub, resume em português e salva em `DOC/libs/` e `~/.kvasir/knowledge/libs/` | ✅ |
| `kvasir doc --code [caminho]` | Documenta o código do projeto em `DOC/code/` (`--all` = projeto inteiro, `--force` = refaz) | ✅ |
| `kvasir doctor` | Diagnóstico do ambiente com ✅/⚠️/❌ e como corrigir: Node × `engines`, Git, JDK/Android/Expo/EAS (projetos mobile), Ollama e modelos (oferece baixar os que faltam), `~/.kvasir`, VS Code, `gh` | ✅ |
| `kvasir models` | Lista os modelos do Ollama, qual está ativo para cada tarefa e o desempenho real (tempo, tokens, aprovação) | ✅ |
| `kvasir fix` | Copie o erro e rode: ele corrige o arquivo do erro (regra determinística ou IA), abre o diff lado a lado no VS Code, conta os erros iguais no projeto e pergunta se corrige os outros. `kvasir fix --undo` desfaz | ✅ |
| `kvasir review` | Revisa o diff staged seguindo as regras do projeto | 🧪 |
| `kvasir push` / `undo` / `log` | Push (normal ou `--force-with-lease`), desfaz o último commit (soft) e mostra o histórico em tabela | 🧪 |
| `kvasir format` | Roda `npm run format` ou o Prettier | 🧪 |
| `kvasir knowledge search\|add\|link\|show` | Base de conhecimento estilo Obsidian em `~/.kvasir/knowledge/` | 🧪 |
| `kvasir learn` | Consolida o feedback e atualiza `~/.kvasir/profile.md` | 🧪 |
| `kvasir task` / `start` | Busca tasks (Planner/API) e mostra o resumo do dia | 🧪 |

✅ funcionando · 🔧 em desenvolvimento · 🧪 implementado, falta testar

---

## Instalação

**Requisitos**

- Node.js >= 18
- Git
- [Ollama](https://ollama.com) rodando em `http://localhost:11434`
- VS Code (o `kvasir fix` abre o diff com o comando `code`)

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

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`Doc/kvasir-architecture.md`](Doc/kvasir-architecture.md) | Como o código funciona: camadas, AI router, fluxo de cada comando |
| [`Doc/kvasir-current.md`](Doc/kvasir-current.md) | Estado atual: o que funciona, o que falta testar, problemas conhecidos |
| [`Doc/kvasir-roadmap.md`](Doc/kvasir-roadmap.md) | O que vem a seguir, em ordem |
| [`Doc/kvasir-decisions.md`](Doc/kvasir-decisions.md) | Por que cada decisão técnica foi tomada |
| [`Doc/kvasir-vision.md`](Doc/kvasir-vision.md) | Onde o projeto quer chegar |
| [`Doc/ideas/`](Doc/ideas/) | Especificação de módulos futuros |
