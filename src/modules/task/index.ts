import { fetchMyTasks } from '@integrations/planner';
import { select } from '@utils/prompt';
import type { Task } from '@ktypes/task';

export async function runTask(): Promise<void> {
  const { tasks, source } = await fetchMyTasks();

  if (tasks.length === 0) {
    console.log(`No tasks found (source: ${source}).`);
    return;
  }

  const choice = await select<string>(
    'Select a task:',
    tasks.map((task: Task) => ({ name: `${task.id} — ${task.title}`, value: task.id }))
  );

  const selected = tasks.find((task) => task.id === choice);
  if (!selected) return;

  console.log('\nSelected task:');
  console.log(`  ID: ${selected.id}`);
  console.log(`  Title: ${selected.title}`);
  console.log(`  Status: ${selected.status}`);
  console.log('\nRun "kvasir branch" to create a branch linked to this task.');
}
