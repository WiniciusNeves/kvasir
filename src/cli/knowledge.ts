import { Command } from 'commander';
import { searchKnowledge, addKnowledge, linkKnowledge, showKnowledge } from '@modules/knowledge';
import { withErrorHandling } from '@utils/errors';

// Variadic: "kvasir knowledge search react hooks" searches the whole phrase, not only the first word.
async function handleSearch(words: string[]): Promise<void> {
  await searchKnowledge(words.join(' '));
}

export function registerKnowledge(program: Command): void {
  const knowledge = program.command('knowledge').description('Manage the Obsidian-style knowledge base');

  knowledge
    .command('search <query...>')
    .description('Search the knowledge base')
    .action(withErrorHandling(handleSearch));

  knowledge
    .command('add')
    .description('Add a manual knowledge note')
    .action(withErrorHandling(addKnowledge));

  knowledge
    .command('link')
    .description('Link two knowledge notes')
    .action(withErrorHandling(linkKnowledge));

  knowledge
    .command('show')
    .description('Show the knowledge base index and open the graph view in the browser')
    .option('--no-open', 'Only generate the graph HTML, do not open the browser')
    .action(withErrorHandling(showKnowledge));
}
