import { getCurrentBranch } from '@utils/git';
import { readContext } from '@modules/init/contextWriter';
import { fetchMyTasks } from '@integrations/planner';

export async function runStart(): Promise<void> {
  console.log('Starting your day with Kvasir...\n');

  try {
    const context = await readContext();
    console.log(`Project: ${context.project.name} (${context.project.type})`);
    console.log(`Persona: ${context.project.persona}`);
    if (context.activeTask) {
      console.log(`Active task: ${context.activeTask.id} — ${context.activeTask.title}`);
    }
  } catch {
    console.log('No kvasir.context.md found. Run "kvasir init" first.');
  }

  console.log(`Current branch: ${getCurrentBranch()}`);

  const { tasks, source } = await fetchMyTasks();
  if (tasks.length === 0) {
    console.log(`\nNo tasks found (source: ${source}).`);
  } else {
    console.log('\nYour tasks:');
    for (const task of tasks) {
      console.log(`  [${task.status}] ${task.id} — ${task.title}`);
    }
  }

  console.log('\nReady to work.');
}
