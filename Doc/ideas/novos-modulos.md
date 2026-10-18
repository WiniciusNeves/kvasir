# Novos módulos — especificação

> Ordem de implementação definida em `Doc/kvasir-roadmap.md` (Fase 1.5).
> **A fonte da verdade das ideias é `Doc/ideas/backlog.md`** (backlog v2); em caso de conflito, ela vale mais que este arquivo.
> Todos seguem o padrão de 3 camadas do `CLAUDE.md`: `src/cli/<modulo>.ts` (fino) → `src/modules/<modulo>/index.ts` (runner) → `src/utils/` (helpers puros).
> Regras gerais: interface em português, commits/branches/código em inglês, `spawnSync` para git, **nada executa sem `confirm()`**.

---

## 1. `kvasir guard` — checagem de segurança antes do commit

**Objetivo:** impedir que segredos e dados sensíveis entrem no repositório (crítico em projetos fintech).

**Fluxo:**
1. Lê `git diff --cached` (só linhas adicionadas `+`).
2. Roda regras determinísticas (regex) — rápido, sem IA:
   - chaves/tokens: AWS (`AKIA...`), Google API (`AIza...`), GitHub (`ghp_`, `github_pat_`), Stripe (`sk_live_`), JWT (`eyJ...`), chaves privadas (`-----BEGIN ... PRIVATE KEY-----`), `password=`, `secret=`, `api_key=`
   - arquivos proibidos no stage: `.env`, `.env.*`, `*.pem`, `*.p12`, `*.keystore`, `google-services.json`, `GoogleService-Info.plist`
   - dados pessoais: CPF, CNPJ, número de cartão (validar com Luhn para reduzir falso positivo)
   - `console.log` com variáveis tipo `token`, `password`, `card`
3. Casos duvidosos (ex.: string longa de alta entropia) → pergunta à IA se parece segredo real.
4. Mostra relatório com arquivo:linha e severidade (🔴 bloqueia / 🟡 avisa).
5. Opções: cancelar commit, remover arquivo do stage, ou ignorar (com confirmação dupla).

**Integração:** `kvasir commit` chama `runGuard()` antes de gerar a mensagem. Flag `--no-guard` para pular.

**Config:** allowlist em `kvasir.context.md` ou `.kvasirignore` para falsos positivos.

**Arquivos:**
```
src/cli/guard.ts
src/modules/guard/index.ts       # runGuard(): orquestra e mostra relatório
src/modules/guard/rules.ts       # regras regex + arquivos proibidos
src/modules/guard/validators.ts  # luhn(), isCpf(), isCnpj(), entropy()
```

---

## 2. `kvasir pr` — descrição de Pull Request

**Objetivo:** gerar título e descrição do PR a partir da branch.

**Fluxo:**
1. Detecta branch atual e branch base (`develop` ou `main`, conforme o Git Flow).
2. Lê `git log base..HEAD` (commits) e `git diff base...HEAD --stat` + diff resumido.
3. IA gera em **português**:
   - Título (baseado no tipo da branch: `feature/` → "feat: ...")
   - **O que mudou** (bullets)
   - **Como testar** (passos)
   - **Prints/vídeos** (checklist se houver mudança de UI: arquivos `.tsx` em `screens/`, `components/`)
   - **Checklist** (testes, lint, tipos)
4. Mostra o resultado e oferece:
   - copiar (`clipboardy`)
   - criar o PR direto com `gh pr create` (se `gh` instalado)
   - editar e gerar de novo

**Arquivos:**
```
src/cli/pr.ts
src/modules/pr/index.ts     # runPr()
src/utils/git.ts            # + getBaseBranch(), getCommitsSince(), getDiffStat()
```

---

## 3. `kvasir release` — versão e changelog

**Objetivo:** usar os Conventional Commits para versionar automaticamente.

**Fluxo:**
1. Lê commits desde a última tag (`git describe --tags --abbrev=0`).
2. Calcula próxima versão (SemVer): `BREAKING CHANGE`/`!` → major · `feat` → minor · `fix`/`perf` → patch.
3. Gera/atualiza `CHANGELOG.md` agrupado por tipo (Features, Fixes, ...). Sem IA — determinístico.
4. IA (opcional) gera resumo em português para notas de release.
5. Atualiza `version` no `package.json` (e `app.json`/`app.config` em projetos Expo).
6. Com confirmação: commit `chore(release): vX.Y.Z` + tag `vX.Y.Z`.
7. Projeto Expo: prepara mensagem do EAS Update (integra com o futuro `kvasir deploy`).

**Arquivos:**
```
src/cli/release.ts
src/modules/release/index.ts      # runRelease()
src/modules/release/semver.ts     # bumpVersion(commits)
src/modules/release/changelog.ts  # buildChangelog(commits)
```

---

## 4. `kvasir daily` — resumo para a daily

**Objetivo:** gerar o resumo do que foi feito, pronto para colar no chat do time.

**Fluxo:**
1. Lê lista de repositórios em `~/.kvasir/config` (ou procura repos numa pasta raiz configurada).
2. Para cada repo: `git log --author=<email> --since="yesterday"` (na segunda-feira: desde sexta).
3. IA resume em português, curto:
   - **Ontem:** ...
   - **Hoje:** (pergunta ao usuário ou usa task ativa do `kvasir task`)
   - **Impedimentos:** (pergunta)
4. Copia para o clipboard.

**Flags:** `--since <data>`, `--repos <pasta>`.

**Arquivos:**
```
src/cli/daily.ts
src/modules/daily/index.ts   # runDaily()
```

---

## 5. `kvasir doctor` — diagnóstico do ambiente

**Objetivo:** dizer o que falta ou está errado no ambiente de desenvolvimento.

**Checagens (cada uma: ✅ / ⚠️ / ❌ + como corrigir):**
- Node (versão vs `engines` do package.json), npm/yarn
- Git (instalado, `user.name`/`user.email` configurados)
- Projeto Mobile (Expo/RN): JDK (versão compatível), `ANDROID_HOME`, `adb`, Gradle, Expo CLI, EAS CLI (logado?)
- Ollama: rodando em `localhost:11434`? modelos usados pelo `router.ts` instalados?
- Kvasir: `~/.kvasir/` existe, `kvasir.context.md` presente no projeto
- `gh` instalado/logado (usado pelo `kvasir pr`)

Sem IA no fluxo principal (determinístico). IA opcional para explicar um erro específico.

**Arquivos:**
```
src/cli/doctor.ts
src/modules/doctor/index.ts    # runDoctor()
src/modules/doctor/checks/     # um arquivo por checagem: node.ts, git.ts, android.ts, ollama.ts...
```

---

## 6. `kvasir test` — gerar testes (depois de fix e review)

**Objetivo:** gerar testes para os arquivos alterados.

**Fluxo:**
1. Lista arquivos alterados (`git diff --name-only`) que são `.ts`/`.tsx` (ignora testes existentes).
2. Detecta framework: Jest + React Native Testing Library (mobile) / Jest ou Vitest + Testing Library (web).
3. IA gera teste seguindo padrões do projeto (usa testes existentes como exemplo).
4. Mostra o arquivo, pede confirmação, salva ao lado (`__tests__/` ou `.test.tsx`).
5. Roda os testes; se falhar, manda o erro de volta à IA (máx. 3 tentativas) — reaproveita lógica do `kvasir fix`.

**Arquivos:**
```
src/cli/test.ts
src/modules/test/index.ts   # runTest()
```

---

## 7. OmniContext (RAG local)

Ver `Doc/ideas/omnicontext.md`. Depois do AI router.
