import { Command } from 'commander';
import { runAgents, runAgentsSet } from '@modules/agents';
import { withErrorHandling } from '@utils/errors';

export function registerAgents(program: Command): void {
  const agents = program
    .command('agents')
    .description('Show the agent team (one owner per task) and swap the models of an agent')
    .action(withErrorHandling(runAgents));

  agents.command('list').description('Show the agent team with real usage').action(withErrorHandling(runAgents));

  agents
    .command('set [agent]')
    .description('Swap the local models of an agent or keep it off the cloud')
    .action(withErrorHandling(runAgentsSet));
}
