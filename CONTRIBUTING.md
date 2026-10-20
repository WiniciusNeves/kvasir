# Contribuindo com o Kvasir

Obrigado pelo interesse! O Kvasir é uma CLI em Node.js + TypeScript que automatiza o dia a dia do desenvolvedor com IA local (Ollama) e, opcionalmente, IA na nuvem (Gemini, Groq).

> **English:** contributions are welcome in English or Portuguese. User-facing text in the CLI is Portuguese; code, identifiers, commit messages and branch names are English.

## Antes de começar

- Leia o [`CLAUDE.md`](CLAUDE.md): é o guia de arquitetura e de regras do projeto (vale para pessoas e para IAs).
- Para entender o estado atual, veja [`Doc/kvasir-current.md`](Doc/kvasir-current.md); para o porquê das decisões, [`Doc/kvasir-decisions.md`](Doc/kvasir-decisions.md).
- Para ideia nova ou mudança grande, abra uma issue antes do PR para combinarmos o caminho.

## Rodando localmente

Requisitos: Node.js 22.13+, Git e, para os comandos com IA, o [Ollama](https://ollama.com) rodando em `http://localhost:11434`.

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
- Branches: `feature/<algo>`, `fix/<algo>`, `chore/<algo>`, `docs/<algo>`.

## Regras da branch `main`

A `main` é protegida por um ruleset do GitHub. As regras valem para **todo mundo, inclusive o mantenedor** (não há exceções configuradas):

| Regra | O que significa |
|---|---|
| Só por pull request | Ninguém faz `git push` direto na `main`; toda mudança chega por um PR |
| CI obrigatório | O merge só é liberado quando as 4 checagens passam: `build (ubuntu-latest, node 18)`, `build (ubuntu-latest, node 22)`, `build (windows-latest, node 22)` e `build (macos-latest, node 22)` (cada uma roda `npm ci`, `typecheck`, `build` e `kvasir --help`) |
| Só merge commit | Squash e rebase estão desligados: o histórico guarda cada commit como foi feito (a documentação cita IDs de commit) |
| Sem force push | Ninguém reescreve o histórico da `main` |
| Sem exclusão | Ninguém apaga a `main` |
| Aprovações: 0 | Enquanto o projeto tem um único mantenedor, o GitHub não deixaria ele aprovar o próprio PR; por isso o merge não exige aprovação. Se entrarem outras pessoas com permissão de escrita, isto passa a ser 1 aprovação |

## Como uma contribuição chega na `main`

**Se você não é mantenedor** (o caso de quase todo mundo), você não tem permissão de push neste repositório. O caminho é:

1. **Fork:** no GitHub, clique em **Fork** para criar uma cópia do Kvasir na sua conta.
2. **Clone o seu fork** e crie uma branch a partir da `main`:
   ```bash
   git clone https://github.com/<seu-usuario>/kvasir.git
   cd kvasir
   git checkout -b feature/minha-ideia
   ```
3. **Faça a mudança** seguindo as [regras do projeto](#regras-do-projeto) e rode `npm run typecheck` e `npm run build` antes de commitar.
4. **Envie para o seu fork** (`git push -u origin feature/minha-ideia`) e abra o **pull request** para a `main` do `WiniciusNeves/kvasir`. Preencha o template (o que muda, como testou, o que não testou, checklist).
5. **Aprovação do CI (só na primeira vez):** no primeiro PR de alguém de fora, o GitHub **não** roda o CI sozinho. O mantenedor vê o botão "Approve and run workflows" e libera depois de conferir que o PR não traz nada malicioso (por exemplo, mudança no `.github/workflows` tentando usar o CI para outra coisa). Depois que você tiver uma contribuição aceita, os seus próximos PRs rodam o CI direto.
6. **CI:** as 4 checagens rodam em Linux, Windows e macOS. Se alguma falhar, abra o log na aba **Checks** do PR, corrija na mesma branch e faça push de novo: o CI roda outra vez sozinho.
7. **Revisão:** o mantenedor é marcado automaticamente (arquivo `.github/CODEOWNERS`). Ele pode comentar, pedir mudanças ou fazer perguntas. Responda e envie os ajustes na mesma branch.
8. **`main` andou enquanto isso?** Se o GitHub disser que há conflito, traga a `main` atualizada para a sua branch (`git fetch upstream && git merge upstream/main`, com `upstream` apontando para `https://github.com/WiniciusNeves/kvasir.git`), resolva e faça push.
9. **Merge:** só o mantenedor faz o merge, sempre com **merge commit**, quando o CI estiver verde e a mudança estiver de acordo com as regras.

**Se você é o mantenedor**, o fluxo é o mesmo, só que sem fork: branch no próprio repositório → PR → CI verde → merge commit.

**Pull requests do Dependabot:** o Dependabot abre PRs de atualização de dependências (npm toda semana, GitHub Actions todo mês). Eles passam pelo mesmo CI; com tudo verde, o mantenedor confere o que mudou (principalmente versão maior, "major") e faz o merge.

## Pull requests

- Um assunto por PR, com descrição do que muda, como testou e o que não testou.
- Mudou comportamento? Atualize `README.md` e `Doc/kvasir-current.md` (e `Doc/kvasir-architecture.md` se o fluxo mudou).
- Mudou algo em `.github/workflows`? Explique no PR: mudanças no CI são revisadas com mais cuidado.
- O template do PR tem o checklist.

## Segurança

Achou uma falha de segurança? **Não abra issue pública:** veja [`SECURITY.md`](SECURITY.md).

## Conduta

Este projeto segue o [Código de Conduta](CODE_OF_CONDUCT.md).
