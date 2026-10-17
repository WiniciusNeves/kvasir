import { fetchMyTasks, PLANNER_SETUP_HINT } from '@integrations/planner';
import { confirm, select } from '@utils/prompt';
import { readContext, setActiveTask } from '@modules/init/contextWriter';
import { getCurrentBranch } from '@utils/git';
import { noteTaskActivated } from '@modules/knowledge/auto';

export async function runTask(): Promise<void> {
  const context = await readContext();
  if (context.activeTask) {
    console.log(`\nTask ativa: ${context.activeTask.id} — ${context.activeTask.title}`);
  }

  const { tasks, source } = await fetchMyTasks();

  if (source === 'none') {
    console.log(`\nNenhuma fonte de tasks configurada. ${PLANNER_SETUP_HINT}`);
    return;
  }
  if (tasks.length === 0) {
    console.log('\nNenhuma task encontrada no Planner.');
    return;
  }

  const choice = await select<string>(
    'Escolha uma task:',
    tasks.map((task) => ({ name: `[${task.status}] ${task.id} — ${task.title}`, value: task.id }))
  );
  const selected = tasks.find((task) => task.id === choice);
  if (!selected) return;

  console.log(`\n${selected.id} — ${selected.title} (${selected.status})`);

  const approved = await confirm('Definir como task ativa deste projeto (grava em kvasir.context.md)?');
  if (!approved) return;

  const branch = getCurrentBranch();
  const keepBranch = branch && !['main', 'master', 'develop'].includes(branch);
  await setActiveTask({ id: selected.id, title: selected.title, linkedBranch: keepBranch ? branch : '' });
  await noteTaskActivated({ id: selected.id, title: selected.title, status: selected.status });

  console.log(`✅ Task ativa: ${selected.id}.`);
  console.log('Rode "kvasir branch": a descrição da branch já vem preenchida com esta task.');
}
