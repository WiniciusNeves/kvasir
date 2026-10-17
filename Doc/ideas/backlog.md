# Kvasir: backlog completo v2 (fonte da verdade das ideias)

> Junta tudo: o que estava guardado do projeto + tudo o que o Winicius pediu nas conversas.
> **Vale mais que `Doc/ideas/novos-modulos.md` quando houver conflito.**
> Cada bloco: verificar no `src/` se já existe (✅), parcial (🟡) ou falta (❌). Status conferido em `Doc/KVASIR-HANDOFF.md` (Fase 4).

---

## Princípios que valem para tudo

- A IA aprende e melhora com feedback. **NUNCA contornar uma IA que erra com regra fixa no código**; melhorar prompt, contexto e dados. Exceção: correções 100% determinísticas e comprovadas.
- Claude é o CHEFE (analisa, decide, delega, valida). Os modelos locais são os executores.
- Zero token desperdiçado: conhecimento gerado uma vez fica salvo e é reaproveitado.
- Falar do jeito que quiser: o sistema entende intenção; erro de código corrige direto sem perguntar sim/não.
- Interface em português; commits, branches e código em inglês.
- Tudo AI-agnóstico (`kvasir.context.md` + adaptadores) e open source.
- Níveis de autonomia configuráveis (ver bloco 12).

---

## 1. Base de conhecimento estilo Obsidian (PRIORIDADE)

Pasta `~/.kvasir/knowledge/` que abre como vault do Obsidian sem ajustes.

```
knowledge/
├── index.md   # mapa geral
├── libs/      # kvasir doc <lib>
├── patterns/  # padrões de código do dev
├── decisions/ # decisões técnicas (por que X e não Y)
├── tasks/     # histórico de tasks com contexto
├── commits/   # log do que foi feito
├── errors/    # erros resolvidos: causa raiz + correção
└── agents/    # o que cada agente aprendeu / desempenho
```

- Links `[[nota]]`, backlinks, frontmatter (tags, projeto, data, origem), `index.md` automático
- Notas geradas SOZINHAS por `doc`, `fix`, `commit`, `task`, `review`, `learn`
- `kvasir knowledge search | add | link | show` (existe versão básica: verificar o que falta)
- `show` = grafo de conexões em HTML (estilo graph view)
- Sincronizar entre PCs (OneDrive/Drive/GitHub privado)
- Vira a fonte do OmniContext (bloco 2)

## 2. OmniContext (RAG local)

- Módulo isolado `src/rag/` dentro do Kvasir (decidido: NÃO é projeto separado)
- Indexa repositórios de código, PDFs de documentação, anotações pessoais, `knowledge/` e `Doc/`
- Embeddings via Ollama (`nomic-embed-text`) + banco vetorial local (Qdrant ou ChromaDB) usando GPU/VRAM; 100% privado
- Watchers em tempo real (`chokidar`) sem pesar a máquina
- `kvasir index` e `kvasir ask` (responde citando os arquivos)
- Sincronizar contexto Windows ↔ Mac na mesma rede local (P2P/LAN)
- Com contexto grande (até 256k na máquina do dev) dá para mandar o projeto inteiro para análise
- Implementar depois de `fix`, `review` e do AI Router

## 3. Novos módulos (specs em `Doc/ideas/novos-modulos.md`)

- `guard`: bloqueia segredos/dados sensíveis antes do commit (crítico em fintech)
- `pr`: título e descrição de PR
- `daily`: resumo ontem/hoje/impedimentos
- `release`: SemVer + CHANGELOG + tag
- `doctor`: diagnóstico do ambiente
- `test`: gera testes dos arquivos alterados e corrige até passar

## 4. Time de agentes

| Agente | Modelo | Função |
|---|---|---|
| Arquiteto | deepseek-r1 | decisões técnicas, causa raiz |
| Revisor | qwen2.5-coder | code review |
| Documentador | Gemini Flash (fallback llama3.2) | doc de libs e código |
| Testador | qwen2.5-coder | gera e revisa testes |
| Executor | qwen2.5-coder / codellama | commit, branch, format |

- Contexto isolado por agente; um agente não mexe na tarefa do outro
- Claude orquestra: analisa, delega ao agente certo, valida o resultado antes de mostrar
- Agentes extras disponíveis no Ollama para avaliar: claude, codex, opencode, hermes, cline, copilot, qwen, openclaw
- Cada agente é substituível sem mexer nos módulos

## 5. Painel de agentes estilo ClickUp (Agent Board)

Gerenciador de tarefas e dashboard para ver o que cada IA faz.

- Quadro (kanban) por agente: a fazer / em andamento / feito / falhou
- Dono único por tarefa: outra IA não pode pegar uma tarefa que não é dela
- Por IA, medir: quantidade de chamadas, tokens gastos, tempo médio, taxa de aprovação, erros
- Mostrar em que cada IA é melhor ("aqui você usou mais", "aqui rendeu melhor") para o router escolher o modelo com base em dado real
- Visual profissional em HTML no browser (dark mode, Chart.js), junto com o `kvasir stats`
- Alimenta o router, o aprendizado e o `learn`

## 6. AI Router + orquestração

- `src/ai/router.ts`: Gemini Flash (grátis ~1500 req/dia), Groq (grátis) e Ollama como fallback offline
- doc/pesquisa → Gemini · fix/review → Groq/qwen · commit/branch → qwen/codellama · arquitetura → deepseek-r1
- Escolha automática por tarefa e por desempenho (dados do Agent Board)
- Detecta o que a pessoa tem instalado e adapta; se faltar modelo, oferece baixar
- `kvasir models` já existe (🟡)
- Claude como chefe via clipboard bridge enquanto não houver API

## 7. Interpretador de intenção natural

- `src/ai/intent.ts`: "faz o commit aí", "manda pro repo", "ó apareceu um erro", "sim porra", "deixa assim"
- Ações seguras executam direto; destrutivas (deletar branch, force push, reset) pedem confirmação
- Funciona por texto agora e por voz no widget

## 8. `kvasir fix` inteligente

- Corrige só o arquivo do erro colado, sem perguntar; depois informa quantos erros iguais existem e pergunta se expande
- Classifica sozinho simples × complexo; complexo → deepseek-r1 investiga causa raiz, pode fazer perguntas, olha arquivos relacionados e config (tsconfig, versão)
- Diff lado a lado no VS Code; backup + `fix --undo`
- Aprende erros recorrentes e avisa ("3º TS6137 esta semana, quer ajustar o tsconfig?")

## 9. Aprendizado e proatividade

- Feedback assíncrono (aprovar/rejeitar) em `~/.kvasir/feedback/`; `kvasir learn` consolida no `profile.md`, que é vivo
- Perguntas proativas: commit sem review, lib sem doc, branch parada, erro repetido, causa raiz
- `kvasir watch`: monitora terminal/clipboard e oferece corrigir
- Evolução esperada: semana 1 aprende, semana 4 acerta ~80%, mês 3 antecipa

## 10. Stats e deploy

- `kvasir stats`: radar hexagonal (commit, branch, fix, review, doc, task), semana vs mês, cards, tabela, barras por dia, seção "o que aprendeu" (junto com o Agent Board)
- `kvasir deploy`: Mobile → AAB/IPA, EAS Submit, EAS Update (mensagem estilo commit); Web → build + Vercel

## 11. Kvasir Desktop: o widget no cantinho da tela

- Quadradinho/robozinho sempre no topo, num canto, arrastável, sem barra de título, fora da taskbar; ícone no tray
- Ativa clicando OU falando "Kvasir"; abre mini painel e pergunta o que você quer; você fala ou digita
- Estados do robô: parado, ouvindo, pensando, executando, concluído, erro
- Entende fala informal (bloco 7) e executa os módulos do CLI por baixo; ações destrutivas pedem confirmação
- Vê a tela (screenshot / openclaw) para achar erros e oferecer corrigir; fala de volta
- Mostra resumo: task ativa, branch, o que está rodando, status dos agentes
- Tech: Electron ou Tauri+React (decisão pendente); wake word local (openWakeWord/Porcupine) + Whisper + Piper/Edge TTS
- Só depois do CLI estável, router e intenção

## 12. Auto-melhoria e plugins

- Kvasir analisa o próprio uso (taxa de aprovação por módulo, erros) e propõe melhorias no próprio código
- Níveis de autonomia configuráveis pelo dev:
  1. Sempre pergunta
  2. Aplica sozinho o que é seguro e testado
  3. Autônomo total, mas SEMPRE em branch separada, com build + testes e rollback; nunca direto na main
- Fluxo: detecta módulo fraco → propõe patch → branch `chore/self-improve-*` → build + testes → commit → relatório
- Plugins em `~/.kvasir/plugins/`: `kvasir plugin install | create`; qualquer pessoa cria e compartilha
- Kvasir sugere e instala plugins pelo padrão de uso

## 13. Infra, multi-PC e produto

- Repositório GitHub (github.com/WiniciusNeves/kvasir); acessar de qualquer PC (casa, faculdade, trabalho)
- `kvasir setup` / install script: detecta Node, Git, Ollama; baixa modelos que faltam; cria `~/.kvasir`; opção .exe (pkg/nexe) ou Docker depois
- `~/.kvasir` sincronizado entre PCs (link simbólico para Drive/OneDrive)
- Servidor pessoal de IA (PC do dev, 24h) + Tailscale: acesso por celular/faculdade/trabalho; chat; modelos grandes com contexto de 256k
- Compartilhar contexto entre Claudes pelo `CLAUDE.md` e `kvasir.context.md` (não há ligação direta entre contas)
- Personas: criar, listar, remover; ACME é a primeira; outras empresas depois
- Open source + B2B (personas por empresa) + sync de knowledge na nuvem (pago)
- Visão: ajudar qualquer dev no mundo; democratizar acesso à IA

## 14. Integrações de tarefas

- Microsoft Planner (agora), task manager próprio da ACME (API + banco) no futuro
- Task ativa vinculada ao branch e ao `kvasir.context.md`
- `kvasir start` abre o dia: tasks, branch, contexto
- `kvasir docs update` atualiza a documentação do projeto
