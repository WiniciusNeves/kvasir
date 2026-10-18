import { getCurrentBranch } from '@utils/git';
import { loadContext } from '@modules/init/ensure';
import { fetchMyTasks, PLANNER_SETUP_HINT } from '@integrations/planner';
import { printCliError } from '@utils/errors';

export async function runStart(): Promise<void> {
  console.log('Começando o dia com o Kvasir...\n');

  try {
    const context = await loadContext();
    console.log(`Projeto: ${context.project.name} (${context.project.type})`);
    console.log(`Persona: ${context.project.persona}`);
    console.log(
      context.activeTask
        ? `Task ativa: ${context.activeTask.id} — ${context.activeTask.title}`
        : 'Task ativa: nenhuma (use "kvasir task")'
    );
  } catch (error) {
    printCliError(error);
  }

  console.log(`Branch atual: ${getCurrentBranch() || '(fora de um repositório git)'}`);

  // A Planner failure must not abort the morning summary.
  try {
    const { tasks, source } = await fetchMyTasks();
    if (source === 'none') {
      console.log(`\n${PLANNER_SETUP_HINT}`);
    } else if (tasks.length === 0) {
      console.log('\nNenhuma task no Planner.');
    } else {
      console.log('\nSuas tasks:');
      tasks.forEach((task) => console.log(`  [${task.status}] ${task.id} — ${task.title}`));
    }
  } catch (error) {
    console.log('');
    printCliError(error);
  }

  console.log('\nPronto para trabalhar.');
}
