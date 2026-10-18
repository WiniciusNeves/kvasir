import { Command } from 'commander';
import { runPersonaList, runPersonaShow, runPersonaCreate, runPersonaRemove } from '@modules/persona';
import { withErrorHandling } from '@utils/errors';

export function registerPersona(program: Command): void {
  const persona = program.command('persona').description('Manage personas (company conventions for branches and commits)');

  persona.command('list').description('List built-in and custom personas').action(withErrorHandling(runPersonaList));
  persona.command('show <name>').description('Show the rules of a persona').action(withErrorHandling(runPersonaShow));
  persona.command('create').description('Create a persona (copy an existing one or start from scratch)').action(withErrorHandling(runPersonaCreate));
  persona.command('remove <name>').description('Remove a custom persona (or reset a built-in one)').action(withErrorHandling(runPersonaRemove));
}
