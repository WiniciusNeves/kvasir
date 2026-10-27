# Kvasir: roadmap (lista do que falta)

> **Atualizado em 2026-10-27.** Se a conversa com a IA se perder, recomece por aqui: esta é a lista completa do que falta, em ordem.
> Estado atual e problemas conhecidos: `kvasir-current.md` · Ideias completas: `ideas/backlog.md` · Visão: `kvasir-vision.md`
> Regras: termine um bloco antes do próximo; módulo novo (bloco 4 em diante) só com aprovação do Winicius; testes em projeto da empresa só com IA local (`kvasir models --cloud off`, religar depois).

---

## 1. Rápido (fechar primeiro)

- [ ] Dependabot: mergear o #25 (fs-extra 11.4.1, revisado: pode mergear)
- [ ] Dependabot: o #23 (dev-dependencies) e o #24 (cosmiconfig 10) **não** podem ser mergeados como estão; antes, um PR pequeno de correção (revisão feita numa sessão separada em 2026-10-27; refazer a análise se ela se perdeu)
- [ ] Problema conhecido #12: encerrar o `kvasir watch` por fora deixa o servidor (ex.: Metro) rodando no Windows. Fechar a árvore de processos (`taskkill /PID <pid> /T`) em `@utils/process`

## 2. Testes de uso real (num projeto Expo real, só IA local)

- [ ] `kvasir commit` interativo de ponta a ponta com os exemplos do desenvolvedor (aprovar, editar, rejeitar) e conferir o `kvasir stats` (com × sem exemplos)
- [ ] `kvasir branch` interativo (com exemplos) e o menu do `branch`
- [ ] `kvasir test` (gerar testes) com o contexto do projeto
- [ ] `kvasir docs update` no projeto
- [ ] Validação do Claude **sem pular** (colar no Claude, copiar a resposta, "Já copiei")
- [ ] `push` contra remoto real, `undo`, `log`, `format` (nunca testados de verdade)
- [ ] Review: no último teste o modelo local achou 2 de 3 bugs plantados (não citou um `console.log`; errou uma linha e chamou divisão por zero de "segurança"). Medir de novo depois do bloco 3

## 3. Melhorias do aprendizado

- [ ] Review com veredito por achado (útil / ignorar), para aprender quais avisos o desenvolvedor ignora; hoje é só "útil? sim/não" para a revisão inteira
- [ ] "Por quê?" opcional ao rejeitar uma sugestão (vira exemplo e feedback)
- [ ] `learn` automático (sem rodar `kvasir learn` à mão)
- [ ] Preferências por projeto (o estilo de um projeto não vaza para outro)

## 4. `kvasir deploy` (explicar o plano antes de começar)

- Mobile (Expo): EAS Build (AAB/IPA), EAS Submit, EAS Update (OTA, mensagem no estilo commit)
- Web: build + deploy (Vercel ou outro)
- Detecta o tipo de projeto sozinho; nada sobe sem confirmação

## 5. Produto e infra

- [ ] `kvasir setup`: instalador que detecta Node, Git e Ollama, baixa os modelos que faltam e cria o `~/.kvasir`
- [ ] README e guia de instalação para outras pessoas; publicar no npm
- [ ] `~/.kvasir` sincronizado entre PCs (Windows ↔ Mac; primeiro por pasta sincronizada)
- [ ] Servidor pessoal de IA 24h + Tailscale (acesso de qualquer lugar)
- [ ] Extensão do VS Code
- [ ] Integrações: task manager da empresa (API própria), GitHub Actions
- [ ] Open source + B2B (personas por empresa), sync na nuvem pago

## 6. Kvasir Desktop (detalhes em `ideas/backlog.md`, bloco 11)

- Robozinho sempre no topo, arrastável, ativado por clique ou pela voz ("Kvasir")
- **A posição dele define o que ele olha:** num canto fica quieto; arrastado para cima de uma janela, gruda nela e acompanha só aquela janela; arrastado para o topo da tela, cresce e olha a tela inteira
- Só depois do CLI estável

## 7. Auto-melhoria e plugins (`ideas/backlog.md`, bloco 12)

- O Kvasir analisa o próprio uso e propõe patches no próprio código, sempre em branch `chore/self-improve-*`, com build, testes e rollback
- `kvasir plugin install | create` em `~/.kvasir/plugins/`

---

## Já feito (resumo)

- Core: `init`, `commit`, `branch`, `doc`, `doc --code`, `models`, `fix`, `review`, `knowledge`, `learn`, `task`, `start`, menu e linguagem natural
- Módulos: `guard`, `pr`, `daily`, `release`, `doctor`, `test`, `watch`, `stats`, `docs update`, `proactive`, `agents` (time de agentes + Agent Board)
- AI Router v2: ranking por desempenho medido, fallback nuvem → Ollama, Gemini e Groq opcionais, validação do Claude só enquanto o modelo não provou que acerta (pode pular)
- OmniContext (RAG local) com `index` / `ask`, usado pelos prompts que se beneficiam
- Aprendizado pelos exemplos do próprio desenvolvedor (commits do git, aprovações e edições), medido no `stats`
- `watch` validado num projeto Expo real (erros de tipo, testes falhando, build do Metro, modo clipboard)
