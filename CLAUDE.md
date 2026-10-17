# CLAUDE.md: Kvasir CLI

Kvasir is a modular CLI productivity ecosystem for developers (Node.js + TypeScript). It detects the project, applies a persona (ACME), generates AI context files, and automates branch, commit, fix, review, doc and task workflows using **local AI (Ollama)** orchestrated by **Claude via clipboard**. Nothing runs without user approval.

---

## Read before working

| File | When |
|---|---|
| `Doc/kvasir-current.md` | What exists, module status, **known issues** |
| `Doc/kvasir-architecture.md` | How the code works: layers, AI router, flow of each command |
| `Doc/kvasir-roadmap.md` | Implementation order (current: **`kvasir fix`**) |
| `Doc/ideas/backlog.md` | **Source of truth for all ideas** (backlog v2, 14 blocks + principles). Wins over `novos-modulos.md` on conflict |
| `Doc/ideas/novos-modulos.md` | Specs for upcoming modules (`guard`, `pr`, `daily`, `release`, `doctor`, `test`) |
| `Doc/ideas/omnicontext.md` | Local RAG module (after AI Router v2) |
| `Doc/kvasir-decisions.md` | Why things are the way they are; don't re-litigate without reason |

**Finish the current module before starting the next one.** After changing behavior, update `Doc/kvasir-current.md` (and `kvasir-architecture.md` if the flow changed).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js >= 18 |
| Language | TypeScript (strict, `noUnusedLocals`, `noImplicitReturns`) |
| CLI | commander |
| Prompts | @inquirer/prompts (wrapped in `@utils/prompt`) |
| HTTP | axios |
| FS | fs-extra (wrapped in `@utils/fs`) |
| AI (executor) | Ollama at `http://localhost:11434` |
| AI (orchestrator) | Claude via clipboard (`clipboardy`), **no Anthropic SDK, no API key** |
| Validation | zod (used for external data: `integrations/planner.ts`) |
| Build | `tsc` + `tsc-alias`; templates copied to `dist/personas/templates` |

Scripts: `npm run dev -- <cmd>` · `npm run build` · `npm run typecheck` · `npm link` for global `kvasir`.

---

## Folder Architecture

```
src/
├── cli/            # one file per command + index.ts (registers all), thin
├── modules/<name>/ # runner: index.ts (+ helpers, e.g. init/detector.ts, doc/code.ts)
├── ai/
│   ├── router.ts   # askFor / askLocal(task, prompt, { maxTokens?, temperature? }), MODEL_MAP, AiTask
│   ├── parse.ts    # defensive parsing of model answers
│   ├── ollama.ts   # askOllama(prompt, { model?, maxTokens?, timeoutMs? }), listInstalledModels()
│   └── client.ts   # promptAI(prompt): clipboard bridge to Claude
├── adapters/       # claude.ts, copilot.ts, cursor.ts (read kvasir.context.md)
├── personas/       # acme.ts + templates/acme-mobile.md, acme-web.md
├── integrations/   # planner.ts (KVASIR_PLANNER_API_URL / _TOKEN)
├── utils/          # git, fs, prompt, editor, typecheck, process, feedback, errors
└── types/          # context, persona, feedback, knowledge, task
```

### Path aliases

| Alias | Maps to |
|---|---|
| `@cli/*` | `src/cli/*` |
| `@modules/*` | `src/modules/*` |
| `@adapters/*` | `src/adapters/*` |
| `@ai/*` | `src/ai/*` |
| `@utils/*` | `src/utils/*` |
| `@ktypes/*` | `src/types/*` (**not** `@types`: that conflicts with DefinitelyTyped) |
| `@integrations/*` | `src/integrations/*` |

---

## Module Pattern (3 tiers)

| Tier | Location | Responsibility |
|---|---|---|
| CLI | `src/cli/<name>.ts` | Register command/flags, wrap with `withErrorHandling`, call runner. **No logic.** |
| Runner | `src/modules/<name>/index.ts` | Orchestrate: context → AI → show → `confirm()` → execute → `recordFeedback()` |
| Utils | `src/utils/` | Pure helpers. No AI calls, no business decisions. |

### Tier 1: CLI (real example)

```ts
// src/cli/fix.ts
import { Command } from 'commander';
import { runFix } from '@modules/fix';
import { withErrorHandling } from '@utils/errors';

export function registerFix(program: Command): void {
  program
    .command('fix')
    .description('Analyze an error and propose a fix')
    .action(withErrorHandling(runFix));
}
```

Then register it in `src/cli/index.ts` (`registerFix(program)`).

### Tier 2: Runner (real pattern, from `commit`)

```ts
// src/modules/commit/index.ts (simplified)
export async function runCommit(): Promise<void> {
  const diff = getDiff();                                   // @utils/git
  if (!diff.trim()) { /* offer stageAll() */ }

  await loadContext();                                      // throws if no kvasir.context.md

  const response = await askFor('commit', buildCommitPrompt(diff)); // @ai/router
  const message = parseMessage(response);                   // handle backticks / extra text

  const action = await select<CommitChoice>('Usar esta mensagem?', [
    { name: 'Sim — commitar', value: 'yes' },
    { name: 'Não — cancelar', value: 'no' },
    { name: 'Editar — modificar antes de commitar', value: 'edit' },
  ]);
  if (action === 'no') {
    await recordFeedback('commits', 'rejected', message);
    return;
  }

  commitWithMessage(finalMessage);                          // only after approval
  await recordFeedback('commits', 'approved', message);
}
```

### Tier 3: Utils (real example)

```ts
// src/utils/git.ts
export function getDiff(): string {
  const result = spawnSync('git', ['diff', '--cached'], { encoding: 'utf-8', cwd: process.cwd() });
  if (result.error) throw result.error;
  return result.stdout ?? '';
}
```

---

## AI Layer: how to call models

| Use | Function | Notes |
|---|---|---|
| **Default** | `askFor(task, prompt, opts?)` | Claude picks a model from the installed ones in `MODEL_MAP[task]` (clipboard), Ollama runs with fallback + 120s timeout, Claude validates (clipboard). `opts`: `maxTokens`, `temperature` |
| Batch / fast, no orchestration | `askLocal(task, prompt, opts?)` | First installed model of `MODEL_MAP[task]` with fallback, no clipboard (`doc --code`, `fix` expansion) |
| Raw | `askOllama(prompt, { model })` | Used by the router. Prefer `askLocal`; if you call it, pass `model` explicitly (default is `codellama`) |
| Claude only | `promptAI(prompt)` | Prompt goes to the clipboard; the user copies Claude's answer and presses Enter (read back from the clipboard, multi-line safe) |

- New task type? Add it to `AiTask` and `MODEL_MAP` in `router.ts`; `kvasir models` picks it up automatically.
- **Never** import `axios`/Ollama/clipboardy directly in a module; go through `src/ai/`.
- Prompts are written in Portuguese. When the output must be English (commits, branches), say it explicitly.
- Local models often wrap answers in backticks, labels, `<think>` blocks or explanations: **always parse defensively** with `@ai/parse` (`cleanAnswer`, `answerLines`, `pickLine`, `truncateForPrompt`); see `parseBranchName`, `parseCommitMessage`, `parseCorrectedLine`.
- Prompt shape that works with local models: data first (diff, snippet), instructions last, the exact output format, "one line only" when parsing a line; pass known facts (install command, links, export names) instead of letting the model invent them.
- Prefer **deterministic fixes/rules before AI** when the answer is known (see `DETERMINISTIC_FIXES` in `fix`).

---

## Project Context

- `kvasir.context.md` (in the target project) is the source of truth. Read it with `loadContext()` / `readContext()` from `@modules/init/contextWriter`; both throw if it's missing ("Run kvasir init first").
- `KvasirContext` type: `project { name, type, stack[], persona }`, `developer.profile`, `branchRules`, `commitRules`, `activeModules[]`, `activeTask | null`, `summary`.
- Detection (`init/detector.ts`): ACME if `package.json` `name` **includes** `acme`; stack from deps (`next`, `expo`, `express`/`fastify`).
- `CLAUDE.md` generated by `adapters/claude.ts` refreshes **only** the block between `<!-- kvasir:header:start -->` and `<!-- kvasir:header:end -->`.

## Global data (`~/.kvasir/`)

`profile.md` · `personas/<name>.json` · `feedback/{commits,fixes,patterns}.md` (via `recordFeedback`) · `knowledge/{libs,patterns,decisions,tasks,commits}/`

---

## Rules

### Approval (semi-automatic)
**Nothing runs without user approval.** Every module that writes a file, runs git or a shell command must:
1. Show what it will do
2. Ask via `confirm()` / `select()` from `@utils/prompt`
3. Only then execute

When modifying a user file, back it up first and restore on rejection. Exception: `kvasir fix` applies the pasted error's fix without asking (user decision, see `kvasir-decisions.md`), backing up to `~/.kvasir/backups/fix/` with `kvasir fix --undo`.

### Shell & git
- Git and shell commands use **`spawnSync` with an args array**. Never `execSync` (Windows breaks on flags). Add new git helpers to `@utils/git`.
- **Never `shell: true`, `exec` or `execSync`.** For `npm`/`npx`/`code` use `runCommand(bin, args)` from `@utils/process` (on Windows it calls `cmd.exe /d /s /c` with escaped args, because spawning a `.cmd` without a shell throws `EINVAL`). Git helpers check `status` via `assertGitSuccess`.

### Language
- **User-facing text (console, prompts, confirmations): Portuguese.**
- Commit messages, branch names, code, identifiers, CLI `.description()`: English.

### TypeScript
- Explicit interfaces, no `any`. Explicit return types on exported functions.
- `type` for unions, `interface` for object shapes. Shared types live in `src/types/` (`@ktypes/*`); file-local types may stay in the module.
- `import type` for type-only imports.

### Function style
| Context | Style |
|---|---|
| Exported runners | `export async function runX(): Promise<void>` |
| Utilities / helpers | `function` declaration |
| Callbacks | arrow function |

Never use arrow functions for top-level exported functions.

### Errors
- Throw `Error` with a clear message; `withErrorHandling` prints it in red. Don't `process.exit` inside modules.
- Network/Ollama failures: catch and show a Portuguese hint (e.g. "Verifique se o Ollama está rodando").

---

## Adding a new module (checklist)

1. `src/modules/<name>/index.ts` with `export async function run<Name>(): Promise<void>`
2. `src/cli/<name>.ts` with `register<Name>(program)` using `withErrorHandling`
3. Register in `src/cli/index.ts`
4. If it uses AI: add an `AiTask` + `MODEL_MAP` entry, call `askFor`
5. New git operations go in `@utils/git`; new types go in `src/types/`
6. `confirm()` before any side effect; `recordFeedback()` if user approves/rejects AI output
7. `npm run typecheck`
8. Update `README.md` (commands table), `Doc/kvasir-current.md`, and `Doc/kvasir-architecture.md`

---

## Do's and Don'ts

### ✅ Do
- Keep CLI files thin.
- Go through `src/ai/` for every model call.
- Ask for approval before writing files or running git.
- Parse AI output defensively.
- Update `Doc/` when behavior changes.

### ❌ Don't
- Use the Anthropic SDK or require an API key (company account has none; see decisions).
- Use `execSync` for git.
- Hardcode persona rules inline; load them via `personaLoader`.
- Put business logic in `src/cli/` or `src/utils/`.
- Start a roadmap module before the current one is finished.
