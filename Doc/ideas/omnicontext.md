# OmniContext — RAG local no Kvasir

> Status: **ideia** (implementar depois de `fix`, `review` e do AI router)

## Problema

Devs perdem horas trocando de contexto entre IDE, documentação, terminal e anotações.
As ferramentas de IA atuais mandam o código para a nuvem (o que viola regras de privacidade de muitas empresas)
ou não sabem o que existe nas outras máquinas do mesmo usuário.

## Solução

Um módulo do Kvasir que roda 100% local e indexa:

- repositórios de código
- PDFs de documentação
- anotações pessoais (incluindo `~/.kvasir/knowledge/`)

O texto vira embeddings, que ficam num banco vetorial local. As perguntas são respondidas com RAG,
usando a GPU/VRAM da própria máquina através do Ollama.

## Comandos planejados

```bash
kvasir index [pasta]   # indexa/reindexa uma pasta
kvasir ask "pergunta"  # responde usando o contexto indexado
```

Os outros módulos (`review`, `fix`) também passam a consultar o contexto antes de responder.

## Decisões

- Fica **dentro do Kvasir**, como módulo isolado em `src/rag/` com interface própria (`index()`, `search()`).
  Se um dia crescer muito, dá para separar em outro repositório sem reescrever.
- Ordem: terminar `fix`, `review` e o AI router antes de começar.

## Stack sugerida

| Parte         | Opção                                           |
|---------------|-------------------------------------------------|
| Embeddings    | Ollama + `nomic-embed-text`                     |
| Banco vetorial| Qdrant (ou ChromaDB) local                      |
| Watchers      | `chokidar` (Node) com debounce e ignore de `node_modules`, `dist`, `.git` |
| LLM           | Modelos já usados no `router.ts`                |

## MVP (começar pequeno)

1. Indexar só `~/.kvasir/knowledge/` e a pasta `Doc/` dos projetos.
2. `kvasir ask` com busca por similaridade + resposta do LLM citando os arquivos usados.
3. Depois: watchers em tempo real, PDFs e repositórios inteiros.

## Sincronização Windows ↔ Mac

- **Simples (primeiro):** sincronizar os *arquivos fonte* (Git ou Syncthing) e cada máquina reindexa localmente.
  Evita conflitos e a exigência de usar exatamente o mesmo modelo de embedding nas duas máquinas.
- **Avançado (desafio de aprendizado):** sincronização P2P/LAN do banco vetorial.

## Pendente

- App desktop: **Tauri** (mais leve, ensina Rust) ou **Electron** (tudo em Node/TS)? Decidir antes de começar o app.
