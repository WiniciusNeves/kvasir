import { confirm, input, select } from '@utils/prompt';
import { MAIN_MENU, SUBMENUS, allEntries } from './catalog';
import type { CatalogEntry, CatalogGroup } from './catalog';
import { interpretIntent } from './intent';
import { recordOutcome } from '@ai/metrics';

const EXIT = '__exit__';
const MAX_TYPO_DISTANCE = 2;

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function closestCommand(word: string, knownCommands: string[]): string | null {
  let best: { name: string; distance: number } | null = null;
  for (const name of knownCommands) {
    const distance = levenshtein(word.toLowerCase(), name);
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best && best.distance <= MAX_TYPO_DISTANCE ? best.name : null;
}

// Fills the missing argument of a command that needs one (doc <lib>, persona show <nome>...).
async function completeArgs(argv: string[]): Promise<string[] | null> {
  const entry = allEntries().find((item) => item.ask && item.argv.join(' ') === argv.join(' '));
  if (!entry?.ask) return argv;

  const value = (await input(entry.ask.message)).trim();
  if (!value && entry.ask.required) {
    console.log('Nada informado. Cancelado.');
    return null;
  }
  return value ? [...argv, value] : argv;
}

async function pickFrom(groups: CatalogGroup[], message: string): Promise<CatalogEntry | null> {
  const entries = groups.flatMap((group) => group.entries.map((entry) => ({ group: group.title, entry })));
  const choice = await select<string>(message, [
    ...entries.map(({ group, entry }, index) => ({
      name: groups.length > 1 ? `${group} · ${entry.label}` : entry.label,
      value: String(index),
    })),
    { name: 'Sair', value: EXIT },
  ]);
  return choice === EXIT ? null : entries[Number(choice)].entry;
}

async function runEntry(entry: CatalogEntry | null): Promise<string[] | null> {
  if (!entry) return null;
  if (entry.submenu) return openSubmenu(entry.submenu);
  return completeArgs(entry.argv);
}

async function openSubmenu(name: string): Promise<string[] | null> {
  const group = SUBMENUS[name];
  return runEntry(await pickFrom([group], `${group.title}: o que você quer fazer?`));
}

async function confirmSuggestion(argv: string[], reason: string, fromAi = false): Promise<string[] | null> {
  console.log(`${reason} kvasir ${argv.join(' ')}`);
  const approved = await confirm('Rodar agora?');
  // the interpreter's answer was judged by the user: feeds performance-based routing
  if (fromAi) await recordOutcome('intent', approved ? 'approved' : 'rejected');
  if (!approved) return null;
  if (argv.length === 1 && SUBMENUS[argv[0]]) return openSubmenu(argv[0]);
  return completeArgs(argv);
}

// Turns whatever the user typed into a real command line:
// nothing → main menu · a group alone (keys, persona, knowledge) → its submenu · a typo → closest
// command · a sentence → the interpreter. Returns null when there is nothing to run.
export async function resolveCommandLine(args: string[], knownCommands: string[]): Promise<string[] | null> {
  if (args.length === 0) {
    return runEntry(await pickFrom(MAIN_MENU, 'O que você quer fazer? (dica: dá para digitar "kvasir <o que você quer>")'));
  }

  const [first] = args;
  if (args.length === 1 && SUBMENUS[first]) return openSubmenu(first);
  if (first.startsWith('-') || first === 'help' || knownCommands.includes(first)) return args;

  const typo = args.length === 1 ? closestCommand(first, knownCommands) : null;
  if (typo) return confirmSuggestion([typo], `"${first}" não é um comando. Você quis dizer:`);

  const sentence = args.join(' ');
  console.log('🤔 Entendendo o pedido...');
  const intent = await interpretIntent(sentence, knownCommands);
  if (intent) return confirmSuggestion(intent, 'Entendi:', true);

  console.log(`Não encontrei um comando para "${sentence}".`);
  if (await confirm('Abrir o menu com todos os comandos?')) return resolveCommandLine([], knownCommands);
  return null;
}
