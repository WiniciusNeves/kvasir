import { Command } from 'commander';
import { runDoctor } from '@modules/doctor';
import { withErrorHandling } from '@utils/errors';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose the development environment (Node, Git, Android/Expo, Ollama, Kvasir, gh)')
    .action(withErrorHandling(runDoctor));
}
