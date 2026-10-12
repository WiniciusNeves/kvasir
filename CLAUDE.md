# CLAUDE.md — Kvasir CLI

Kvasir is a modular productivity ecosystem for developers. It detects the project type, applies the right persona, and assists with branch, commit, doc, fix, format, and task workflows.

---

## Tech Stack

| Layer       | Technology                        |
| ----------- | --------------------------------- |
| Runtime     | Node.js                           |
| Language    | TypeScript (strict)               |
| CLI         | Commander.js                      |
| Config/FS   | fs-extra, cosmiconfig             |
| AI          | Anthropic SDK (@anthropic-ai/sdk) |
| HTTP        | axios                             |
| Validation  | zod                               |

---

## Folder Architecture

```
kvasir/
├── src/
│   ├── cli/                        # Command entry points — thin, no logic
│   │   ├── index.ts                # Root CLI: registers all commands
│   │   ├── init.ts                 # kvasir init command
│   │   ├── branch.ts               # kvasir branch command
│   │   ├── commit.ts               # kvasir commit command
│   │   ├── fix.ts                  # kvasir fix command
│   │   ├── format.ts               # kvasir format command
│   │   ├── doc.ts                  # kvasir doc command
│   │   └── task.ts                 # kvasir task command
│   ├── modules/                    # Core logic — one folder per module
│   │   ├── init/
│   │   │   ├── index.ts            # runInit(): orchestrates the init flow
│   │   │   ├── detector.ts         # detectProject(): reads package.json, infers type
│   │   │   ├── personaLoader.ts    # loadPersona(): loads from ~/.kvasir/personas/
│   │   │   └── contextWriter.ts    # writeContext(): writes kvasir.context.md
│   │   ├── branch/
│   │   │   └── index.ts            # runBranch(): generates branch name from task
│   │   ├── commit/
│   │   │   └── index.ts            # runCommit(): reads git diff, generates message
│   │   ├── fix/
│   │   │   └── index.ts            # runFix(): reads error, proposes fix
│   │   ├── format/
│   │   │   └── index.ts            # runFormat(): runs formatter before commit
│   │   ├── doc/
│   │   │   └── index.ts            # runDoc(): fetches lib docs, saves to doc/
│   │   └── task/
│   │       └── index.ts            # runTask(): fetches tasks from Planner/API
│   ├── adapters/                   # Output adapters — one file per target AI
│   │   ├── claude.ts               # Writes CLAUDE.md from kvasir.context.md
│   │   ├── copilot.ts              # Writes .github/copilot-instructions.md
│   │   └── cursor.ts               # Writes .cursor/rules
│   ├── personas/                   # Built-in personas (loaded at runtime)
│   │   └── acme.ts                  # ACME persona: stack, branch, commit rules
│   ├── ai/                         # Anthropic SDK wrapper
│   │   └── client.ts               # askAI(prompt): returns string response
│   ├── integrations/               # External API integrations
│   │   └── planner.ts              # fetchMyTasks(): calls Planner or custom API
│   ├── utils/                      # Shared helpers
│   │   ├── git.ts                  # getDiff(), getCurrentBranch(), etc.
│   │   ├── fs.ts                   # readJson(), writeFile(), ensureDir()
│   │   └── prompt.ts               # confirm(), select(), input() wrappers
│   └── types/                      # All TypeScript types
│       ├── persona.ts              # Persona, PersonaStore types
│       ├── context.ts              # KvasirContext type
│       └── task.ts                 # Task type
├── ~/.kvasir/                      # Global user config (outside repo)
│   ├── profile.md                  # Developer profile: preferences, rules
│   └── personas/                   # Saved personas (auto-generated or custom)
│       └── acme.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Module Pattern

Every module follows three tiers. Each tier has one strict responsibility.

| Tier        | Location          | Responsibility                                      |
| ----------- | ----------------- | --------------------------------------------------- |
| CLI command | `src/cli/`        | Parse args, call module runner, nothing else        |
| Runner      | `src/modules/`    | Orchestrate: read context → call AI → write output  |
| Utility     | `src/utils/`      | Pure helpers: git, fs, prompts — no business logic  |

---

### Tier 1 — CLI command (`src/cli/`)

Only parses arguments and calls the runner. No logic lives here.

```ts
// src/cli/commit.ts
import { Command } from 'commander';
import { runCommit } from '@modules/commit';

export function registerCommit(program: Command) {
  program
    .command('commit')
    .description('Generate a commit message from git diff')
    .action(async () => {
      await runCommit();
    });
}
```

---

### Tier 2 — Runner (`src/modules/`)

Orchestrates the full flow: reads context, calls AI if needed, writes output, asks for approval.

```ts
// src/modules/commit/index.ts
import { getDiff } from '@utils/git';
import { askAI } from '@ai/client';
import { confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';

export async function runCommit() {
  const diff = await getDiff();
  const context = await loadContext();

  const message = await askAI(`
    Project context: ${context.summary}
    Commit conventions: ${context.commitRules}
    Git diff:
    ${diff}
    Generate a commit message following the conventions above.
  `);

  console.log('\nSuggested commit message:');
  console.log(message);

  const approved = await confirm('Use this message?');
  if (approved) {
    // execute git commit
  }
}
```

---

### Tier 3 — Utils (`src/utils/`)

Pure helpers. No AI calls, no business decisions.

```ts
// src/utils/git.ts
import { execSync } from 'child_process';

export function getDiff(): string {
  return execSync('git diff --staged').toString();
}

export function getCurrentBranch(): string {
  return execSync('git branch --show-current').toString().trim();
}
```

---

## Project Detection (kvasir init)

```ts
// src/modules/init/detector.ts
import { readJson } from '@utils/fs';

export async function detectProject(): Promise<'acme' | 'unknown'> {
  const pkg = await readJson('package.json');
  if (pkg?.name?.startsWith('acme-')) return 'acme';
  return 'unknown';
}
```

Detection rules:
- `name` starts with `acme-` → ACME persona
- No match → prompt user to create a new persona

---

## ACME Persona

Applied automatically when project is detected as ACME.

### Repository naming
`ACME-<NAME>-<TYPE>` → `-WEB` · `-API` · `-MOBILE` · `-DESKTOP` · `-INFRA` · `-LIB`

### Branch naming (Git Flow)
| Branch      | When                                        |
| ----------- | ------------------------------------------- |
| `feature/*` | New features                                |
| `fix/*`     | Bug fixes in development                    |
| `hotfix/*`  | Critical fixes from production              |
| `release/*` | Deploy preparation                          |
| `chore/*`   | Build, tooling, dependency updates          |

### Commit messages (Conventional Commits)
Structure: `<type>(<scope>): <description in English>`

Types: `feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` · `ci` · `chore` · `revert`

Examples:
- `feat(HomePage): create interactive header`
- `fix(Auth): solve login timeout on mobile`
- `docs(README): add setup instructions for API`

### Stack
- Web: Next.js + TypeScript
- Mobile: React Native + Expo + TypeScript

### Language rule
All branch names, commit messages, and repository names must be in **English**.

---

## kvasir.context.md — Neutral Format

This file is the source of truth. Adapters read it to generate AI-specific files.

```md
# kvasir.context.md

## Project
- name: acme-web-app
- type: ACME
- stack: Next.js, TypeScript
- persona: acme

## Developer
- profile: ~/.kvasir/profile.md

## Branch rules
- pattern: Git Flow ACME
- prefix: feature/ fix/ hotfix/ release/ chore/
- language: English

## Commit rules
- convention: Conventional Commits
- language: English
- format: <type>(<scope>): <description>

## Active modules
- branch, commit, fix, format, doc, task

## Active task
- id: TASK-123
- title: Add face recognition flow
- linked branch: feature/add-face-recognition-flow
```

---

## AI Client

All AI calls go through one single function.

```ts
// src/ai/client.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function askAI(prompt: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type');
  return block.text;
}
```

---

## Adapters

Each adapter reads `kvasir.context.md` and writes the AI-specific file.

```ts
// src/adapters/claude.ts
import { readContext } from '@modules/init/contextWriter';
import { writeFile } from '@utils/fs';

export async function writeClaude() {
  const ctx = await readContext();
  const content = buildClaudemd(ctx);
  await writeFile('CLAUDE.md', content);
}
```

Adapters: `claude.ts` · `copilot.ts` · `cursor.ts`

---

## TypeScript Rules

- Always define explicit interfaces — no `any`, no implicit `{}`.
- All async functions must have explicit return types.
- Prefer `type` for unions/intersections, `interface` for object shapes.
- All types live in `src/types/`, imported via `@types/*`.

---

## Function Nomenclature

| Context                | Style                  | Example                          |
| ---------------------- | ---------------------- | -------------------------------- |
| Module runners         | `async function`       | `export async function runInit` |
| Utility functions      | `function` declaration | `export function getDiff`        |
| Inline callbacks       | Arrow function         | `.action(async () => { … })`     |
| `useCallback` bodies   | Arrow function         | `useCallback(() => { … }, [])`   |

Never use arrow functions for top-level exported functions.

```ts
// ✅ correct
export async function runCommit() { … }
export function detectProject() { … }

// ❌ wrong
export const runCommit = async () => { … };
```

---

## Path Aliases

| Alias          | Maps to          |
| -------------- | ---------------- |
| `@cli/*`       | `src/cli/*`      |
| `@modules/*`   | `src/modules/*`  |
| `@adapters/*`  | `src/adapters/*` |
| `@ai/*`        | `src/ai/*`       |
| `@utils/*`     | `src/utils/*`    |
| `@types/*`     | `src/types/*`    |
| `@integrations/*` | `src/integrations/*` |

---

## Semi-automatic Rule

**Nothing runs without user approval.**

Every module that writes a file or executes a command must:
1. Show what it will do
2. Ask for confirmation via `confirm()`
3. Only then execute

```ts
const approved = await confirm('Create branch feature/add-login?');
if (!approved) return;
```

---

## Do's and Don'ts

### ✅ Do
- Keep CLI files thin — only parse args and call the runner.
- All AI calls go through `src/ai/client.ts`.
- Always ask for user approval before writing files or running git commands.
- Use `kvasir.context.md` as source of truth — adapters read from it.
- One module per folder in `src/modules/`.

### ❌ Don't
- Put business logic in `src/cli/` files.
- Call Anthropic SDK directly from runners — always use `askAI()`.
- Run git commands without user confirmation.
- Hardcode persona rules inline — load from `src/personas/` or `~/.kvasir/personas/`.
- Mix module responsibilities — each module handles one command only.
