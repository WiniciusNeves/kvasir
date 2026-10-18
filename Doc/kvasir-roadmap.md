# Kvasir: roadmap

> O que falta, **em ordem**. Termine uma fase antes de começar a próxima.
> Estado atual: `kvasir-current.md` · Visão: `kvasir-vision.md`

---

## Fase 1: terminar o core ← **agora**

- [x] `init`, `commit`, `branch`, `doc`, `doc --code`, `models`
- [x] Seleção por pasta no `doc --code`
- [x] Menu pós-commit em loop
- [x] `kvasir undo`, `kvasir push`, `kvasir log` separados (com tabela ASCII)
- [x] `kvasir fix` (2026-10-17)
- [x] Testar `review`, `knowledge`, `learn`, `task`, `start` (2026-10-17)
- [ ] Testar `push` contra remoto real, `format`, menu do `branch`
- [ ] Corrigir os problemas conhecidos #7 a #11 de `kvasir-current.md` (#3 a #6 resolvidos)

---

## Fase 1.5: novos módulos (depois do `fix`)

> Especificação completa: `Doc/ideas/novos-modulos.md`

1. [x] `kvasir guard`: bloqueia segredos e dados sensíveis antes do commit (integrado ao `commit`) (2026-10-17)
2. [ ] `kvasir pr`: título e descrição do Pull Request em português
3. [ ] `kvasir review`: finalizar
4. [ ] `kvasir daily`: resumo dos commits para a daily
5. [ ] `kvasir release`: versão SemVer + CHANGELOG a partir dos Conventional Commits
6. [ ] `kvasir doctor`: diagnóstico do ambiente (Node, JDK, Android, Expo, Ollama)
7. [ ] `kvasir test`: gera testes para os arquivos alterados (reaproveita o `fix`)

---

## Fase 2: AI Router v2

Hoje: Claude (clipboard) escolhe o modelo → Ollama executa → Claude (clipboard) valida.

- [ ] Escolha determinística do modelo por padrão (primeiro instalado do `MODEL_MAP`), sem clipboard (problema #1)
- [ ] Validação pelo Claude opcional
- [ ] `src/ai/gemini.ts`: Gemini Flash (gratuito, melhor para português; ~1500 req/dia)
- [ ] `src/ai/groq.ts`: Groq (gratuito, rápido para código)
- [ ] Fallback: nuvem gratuita → Ollama se estiver offline ou se o limite estourar

| Tarefa | Preferido | Fallback |
|---|---|---|
| doc, texto, português | Gemini Flash | Ollama llama3.2 |
| commit, branch, fix, review | Groq | Ollama (codellama / qwen2.5-coder) |
| offline / privado | Ollama | — |

**Requisitos:** chave no [aistudio.google.com](https://aistudio.google.com) e no [console.groq.com](https://console.groq.com) (ambos gratuitos).

---

## Fase 3: contexto e aprendizado

- [x] `task` grava a task ativa no `kvasir.context.md`; `branch` usa a task (2026-10-17)
- [ ] Injetar `profile.md` e notas relevantes do `knowledge/` nos prompts
- [ ] `kvasir stats`: dashboard HTML com gráfico radar (Chart.js): uso × aprovação por módulo, semana × mês
- [ ] `kvasir docs update`: atualiza os docs do projeto automaticamente

---

## Fase 4: OmniContext (RAG local)

> Especificação: `Doc/ideas/omnicontext.md`

- [ ] `kvasir index` / `kvasir ask` com embeddings locais (Ollama + Qdrant), módulo isolado em `src/rag/`
- [ ] `fix` e `review` consultam o RAG
- [ ] Sincronizar Windows ↔ Mac (primeiro via arquivos fonte; P2P depois)

---

## Fase 5: `kvasir deploy`

- **ACME Mobile:** EAS Build (AAB/IPA), EAS Submit, EAS Update (OTA, com mensagem no estilo commit)
- **ACME Web:** build + deploy (Vercel ou outro)
- Detecta o tipo de projeto automaticamente

---

## Fase 6: linguagem natural e agentes

- [ ] `src/ai/intent.ts`: português informal → módulo certo (ações destrutivas pedem confirmação)
- [ ] Time de agentes (Arquiteto, Revisor, Documentador, Testador, Executor) com gerenciador de tarefas

---

## Fase 7: produto

- App desktop (Electron ou Tauri) com bandeja e voz (Whisper + Piper/Edge TTS)
- Extensão VS Code
- Plugins em `~/.kvasir/plugins/` e auto-melhoria
- Sync na nuvem (pago) · personas B2B
- Integrações: task manager próprio da ACME, GitHub Actions, servidor de IA centralizado
