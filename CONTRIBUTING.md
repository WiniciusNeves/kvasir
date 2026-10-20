# Contribuindo com o Kvasir

Obrigado pelo interesse! O Kvasir é uma CLI em Node.js + TypeScript que automatiza o dia a dia do desenvolvedor com IA local (Ollama) e, opcionalmente, IA na nuvem (Gemini, Groq).

> **English:** contributions are welcome in English or Portuguese. User-facing text in the CLI is Portuguese; code, identifiers, commit messages and branch names are English.

## Antes de começar

- Leia o [`CLAUDE.md`](CLAUDE.md): é o guia de arquitetura e de regras do projeto (vale para pessoas e para IAs).
- Para entender o estado atual, veja [`Doc/kvasir-current.md`](Doc/kvasir-current.md); para o porquê das decisões, [`Doc/kvasir-decisions.md`](Doc/kvasir-decisions.md).
- Para ideia nova ou mudança grande, abra uma issue antes do PR para combinarmos o caminho.

## Rodando localmente

Requisitos: Node.js 18+, Git e, para os comandos com IA, o [Ollama](https://ollama.com) rodando em `http://localhost:11434`.

```bash
npm install
npm run build
npm link
kvasir doctor
```

Durante o desenvolvimento: `npm run dev -- <comando>` e `npm run typecheck`.

## Regras do projeto

- **Nada roda sem aprovação:** comando que escreve arquivo, mexe no git ou roda shell mostra o que vai fazer e pergunta antes (`confirm`/`select` de `@utils/prompt`).
- **Shell e git:** sempre `spawnSync` com lista de argumentos ou `runCommand` de `@utils/process`. Nunca `shell: true`, `exec` ou `execSync`.
- **IA:** toda chamada passa por `src/ai/` (router); nunca importe `axios`/Ollama direto num módulo. Não compense erro de modelo com regra fixa no código: melhore o prompt, o contexto ou os dados.
- **Chaves de API:** só em variável de ambiente. Nunca no código, no `~/.kvasir/config.json`, em teste, em log ou em issue.
- **Sem dados pessoais nem nomes reais de empresa** no código, na documentação ou nos exemplos (use nomes genéricos, como "ACME").
- **Idioma:** texto para o usuário em português; código, commits e branches em inglês.
- Comando novo: siga o checklist "Adding a new module" do `CLAUDE.md` (inclui o catálogo do menu e a documentação).

## Commits e branches

- Commits no padrão [Conventional Commits](https://www.conventionalcommits.org/): `feat(watch): ...`, `fix(router): ...`, `docs: ...`.
- Branches: `feature/<algo>`, `fix/<algo>`, `chore/<algo>`.
- A `main` é protegida: tudo entra por pull request, e o CI (typecheck + build em Linux, Windows e macOS) precisa passar.

## Pull requests

- Um assunto por PR, com descrição do que muda, como testou e o que não testou.
- Mudou comportamento? Atualize `README.md` e `Doc/kvasir-current.md` (e `Doc/kvasir-architecture.md` se o fluxo mudou).
- O template do PR tem o checklist.

## Segurança

Achou uma falha de segurança? **Não abra issue pública:** veja [`SECURITY.md`](SECURITY.md).

## Conduta

Este projeto segue o [Código de Conduta](CODE_OF_CONDUCT.md).
