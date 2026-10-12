# Kvasir — Estado Atual (2025-07)

> O que está implementado e funcionando hoje.

---

## Módulos funcionando

### kvasir init ✅
- Detecta tipo de projeto pelas deps do package.json
- `name` contém `acme` → persona ACME aplicada automaticamente
- `expo` nas deps → stack Mobile (RN/Expo) → usa template acme-mobile.md
- `next` nas deps → stack Web (Next.js) → usa template acme-web.md
- Gera `kvasir.context.md` com contexto completo
- Gera `CLAUDE.md` com template rico da stack detectada
- Gera `.cursor/rules` e `.github/copilot-instructions.md`
- Detecta branch ativa do git e inclui no contexto

### kvasir commit ✅
- Verifica staged changes com `spawnSync git diff --cached`
- Se não tiver staged, oferece `git add .`
- Ollama (codellama) gera mensagem Conventional Commits em inglês
- Parse extrai texto dentro de backticks da resposta do Ollama
- Interface em português
- Menu pós-commit: push, push force, undo, log, merge
- Registra aprovação/rejeição em `~/.kvasir/feedback/commits.md`

### kvasir doc \<lib\> ✅
- Busca no npm registry (`https://registry.npmjs.org/<lib>`)
- Fallback: busca no GitHub via `repository.url`
- Ollama (llama3.2) resume em português com seções estruturadas:
  - O que é / Instalação / Principais funcionalidades / Quando usar / Links úteis
- Salva em `DOC/libs/<lib>.md`
- Salva em `~/.kvasir/knowledge/libs/<lib>.md` com links para projetos

### kvasir doc --code ✅
- `--code hooks/useAuth.ts` → arquivo específico
- `--code hooks/` → pasta com confirmação por arquivo
- `--code` → seleção interativa (ainda em ajuste — lista 391 arquivos)
- `--code --all` → projeto inteiro com progresso
- `--code --all --force` → reprocessa mesmo os que já têm doc
- Salva em `DOC/code/<caminho-espelhado>.md`

### kvasir review ✅ (implementado, não testado)
- Lê git diff --cached
- Ollama revisa seguindo padrões do projeto
- Registra feedback em `~/.kvasir/feedback/patterns.md`

### kvasir learn ✅ (implementado, não testado)
- Consolida feedback de `~/.kvasir/feedback/`
- Atualiza `~/.kvasir/profile.md`

### kvasir knowledge ✅ (implementado, não testado)
- search, add, link, show

### kvasir start ✅ (implementado, não testado)
### kvasir task ✅ (implementado, não testado)
### kvasir fix ✅ (implementado, não testado)
### kvasir format ✅ (implementado, não testado)
### kvasir branch ✅ (implementado, não testado)

---

## Bugs conhecidos

| Bug | Status |
|---|---|
| `doc --code` lista 391 arquivos de uma vez | 🔧 Em correção — deve navegar por pasta |
| Menu pós-commit fecha após ação | 🔧 Em correção — deve ficar em loop |
| Histórico `kvasir log` sem formatação | 🔧 Em correção |

---

## Infraestrutura

- Node.js + TypeScript compilado via `tsc` + `tsc-alias`
- `npm link` → comando `kvasir` disponível globalmente
- Ollama rodando em `http://localhost:11434`
- Modelos instalados: `codellama` (4GB), `llama3.2` (2GB)
- `spawnSync` para todos os comandos git (compatibilidade Windows)
- Interface sempre em português, commits sempre em inglês

---

## Arquivos globais criados

```
~/.kvasir/
├── profile.md
├── personas/acme.json
├── feedback/commits.md
└── knowledge/libs/
    ├── axios.md
    └── zustand.md
```
