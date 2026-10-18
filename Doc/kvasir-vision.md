# Kvasir: visão (onde quero chegar)

> Para onde o projeto vai. O que já existe está em `kvasir-current.md`; a ordem de execução está em `kvasir-roadmap.md`.

---

## A ideia em uma frase

Um **assistente de desenvolvimento pessoal, local e open source**: conhece você, conhece o seu código, fala português informal e faz o trabalho repetitivo, sempre pedindo aprovação antes de agir.

---

## Princípios

- **Nada roda sem aprovação.** Ações seguras podem ser diretas; ações destrutivas sempre pedem confirmação.
- **Local primeiro.** Privacidade e custo zero com Ollama; a nuvem gratuita (Gemini Flash, Groq) é opcional.
- **Sem lock-in de IA.** O `kvasir.context.md` é neutro e cada IA tem seu adapter.
- **Contexto gerado uma vez e reutilizado sempre.** Knowledge base local, sem gastar token repetindo coisas.
- **Aprende com você.** O feedback de aprovar/rejeitar melhora as sugestões com o tempo.
- **Modular.** Cada módulo é independente; plugins de terceiros no futuro.

---

## As camadas da visão

### 1. CLI completa (agora)
Todos os módulos do dia a dia estáveis: `init`, `branch`, `commit`, `fix`, `review`, `doc`, `format`, `task`, `knowledge`, `learn`.
Depois vêm `guard`, `pr`, `daily`, `release`, `doctor` e `test` (ver `Doc/ideas/novos-modulos.md`).

### 2. AI Router inteligente
Escolhe o melhor modelo por tarefa, com fallback:
- **Gemini Flash** (gratuito): português, texto, documentação
- **Groq** (gratuito, rápido): código
- **Ollama** (local): offline e privado

### 3. Memória do código: OmniContext (RAG local)
`kvasir index` / `kvasir ask`: indexa código, PDFs e anotações com embeddings locais. Assim o `fix` e o `review` passam a entender o projeto inteiro, não só o diff. Ver `Doc/ideas/omnicontext.md`.

### 4. Linguagem natural
```bash
kvasir "faz o commit aí"            # → kvasir commit
kvasir "cria uma branch pro login"  # → kvasir branch
kvasir "manda pro repo"             # → git push (pede confirmação)
```
Um interpretador de intenção (`src/ai/intent.ts`) mapeia o português informal para o módulo certo.

### 5. Aprendizado contínuo
- `profile.md` atualizado automaticamente com as suas preferências
- Esse perfil e a knowledge base são injetados nos prompts
- `kvasir stats`: dashboard com gráfico radar (uso por módulo, taxa de aprovação, semana × mês)

### 6. Time de agentes
| Agente | Função |
|---|---|
| Arquiteto | Decisões técnicas e planejamento |
| Revisor | Code review e padrões |
| Documentador | Doc de código e de libs |
| Testador | Gera e revisa testes |
| Executor | Commit, branch, format |

Cada agente tem contexto isolado e o modelo mais adequado. Um gerenciador de tarefas evita que dois agentes façam a mesma coisa.

### 7. App desktop com voz
- Ícone na bandeja, mini janela flutuante
- Voz: Whisper (fala → texto) e Piper/Edge TTS (texto → fala)
- Chama os módulos da CLI por baixo
- Tecnologia: Electron ou Tauri (decisão pendente)

### 8. Plataforma
- **Plugins:** `~/.kvasir/plugins/`, que qualquer pessoa pode criar e compartilhar
- **Auto-melhoria:** o Kvasir analisa o próprio uso e propõe melhorias no próprio código (com aprovação)
- **Personas por empresa:** cada empresa cria a sua; o Kvasir traz só uma neutra
- **Extensão VS Code** e Kvasir rodando no CI (GitHub Actions)
- **Servidor de IA pessoal,** acessível de qualquer lugar (celular, faculdade, trabalho)

---

## Modelo de produto

- **CLI gratuita e open source**
- Opcional pago: sync de knowledge, personas e perfil na nuvem
- B2B: times configuram suas próprias personas
- Objetivo maior: **democratizar o acesso à IA para desenvolvimento**, ajudando qualquer dev, não só o autor
