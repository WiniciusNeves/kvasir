# Kvasir — Roadmap

> O que falta implementar, em ordem de prioridade.

---

## Fase 1 — Terminar módulos core (agora)

### Correções pendentes
- [ ] `doc --code` — seleção por pasta em 2 níveis (não lista 391 arquivos)
- [ ] `commit` — menu pós-commit em loop (não fecha após ação)
- [ ] `commit` — histórico formatado com bordas ASCII
- [ ] `commit` — comandos separados `kvasir undo`, `kvasir push`, `kvasir log`

### Módulos para testar
- [ ] `kvasir branch` — gerar nome de branch via Ollama
- [ ] `kvasir fix` — analisar erro e sugerir correção
- [ ] `kvasir review` — revisar código antes do commit
- [ ] `kvasir task` — buscar tasks do Planner
- [ ] `kvasir start` — iniciar o dia
- [ ] `kvasir learn` — consolidar feedback no profile.md
- [ ] `kvasir knowledge` — base de conhecimento

---

## Fase 2 — AI Router

Criar `src/ai/router.ts` que decide qual modelo usar por tarefa:

```
src/ai/
├── router.ts     ← novo — decide qual modelo usar
├── gemini.ts     ← novo — Gemini Flash (gratuito, melhor para português)
├── groq.ts       ← novo — Groq (gratuito, rápido para código)
├── ollama.ts     ← já existe
└── client.ts     ← já existe (clipboard bridge)
```

| Tarefa | Modelo preferido | Fallback |
|---|---|---|
| doc, pesquisa, português | Gemini Flash | Ollama llama3.2 |
| commit, fix, review | Groq | Ollama codellama |
| offline / privado | Ollama | — |

**Requisitos:**
- Conta Gemini: [aistudio.google.com](https://aistudio.google.com) — gratuito
- Conta Groq: [console.groq.com](https://console.groq.com) — gratuito

---

## Fase 3 — Time de Agentes de IA

Cada agente tem um domínio isolado e usa o modelo mais adequado:

| Agente | Função | Modelo |
|---|---|---|
| Arquiteto | Ideias, decisões técnicas, planejamento | Claude |
| Revisor | Code review, padrões, qualidade | Claude/Groq |
| Documentador | Doc de código e libs | Gemini Flash |
| Testador | Gera e revisa testes | CodeLlama |
| Executor | Commit, branch, format (tarefas mecânicas) | CodeLlama |

**Regras:**
- Cada agente tem contexto isolado
- Agentes não interferem nas tarefas uns dos outros
- Gerenciador de tarefas por agente para evitar sobreposição
- `knowledge/` é compartilhado entre todos

---

## Fase 4 — kvasir deploy

```bash
kvasir deploy
```

**ACME Mobile:**
- Gerar AAB (Android → Play Store)
- Gerar IPA (iOS → App Store)
- EAS Update (OTA — sem passar pela loja, exige mensagem tipo commit)

**ACME Web:**
- Build + Deploy (Vercel/outros)

---

## Fase 5 — Produto

### Comandos por voz
```bash
# futuro
kvasir "cria uma branch para corrigir o login"
kvasir "faz o commit do que está staged"
```

### Extensão VS Code
- Kvasir integrado diretamente no VS Code
- Sem precisar do terminal

### kvasir docs update
```bash
kvasir docs update
# → lê estado atual do projeto
# → atualiza kvasir-complete-doc.md automaticamente
```

### B2B
- Cada empresa tem suas personas
- Vende para times de desenvolvimento
- Persona ACME como exemplo/template

### Open Source + Cloud
- CLI gratuito e open source
- Sync de knowledge e personas na cloud (pago)
- Cada dev tem seu perfil na cloud

---

## Integrações futuras

| Integração | O que faz |
|---|---|
| Task manager ACME próprio | API + banco de dados — substitui Planner |
| Servidor de IA centralizado | Ponto único para gerenciar modelos locais |
| GitHub Actions | Kvasir rodando em CI/CD |
