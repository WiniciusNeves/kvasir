import os from 'os';
import path from 'path';
import { readFeedback } from '@utils/feedback';
import { promptAI } from '@ai/client';
import { writeFile, readFile } from '@utils/fs';
import { confirm } from '@utils/prompt';

function getProfilePath(): string {
  return path.join(os.homedir(), '.kvasir', 'profile.md');
}

export async function runLearn(): Promise<void> {
  const [commits, fixes, patterns] = await Promise.all([
    readFeedback('commits'),
    readFeedback('fixes'),
    readFeedback('patterns'),
  ]);

  const combinedFeedback = [commits, fixes, patterns].filter(Boolean).join('\n');

  if (!combinedFeedback.trim()) {
    console.log('No feedback recorded yet. Nothing to learn from.');
    return;
  }

  const currentProfile =
    (await readFile(getProfilePath())) ?? '# profile.md\n\n## Preferências aprendidas\n\n## Stack pessoal\n';

  const updatedProfile = await promptAI(`
    Current developer profile:
    ${currentProfile}
    Recent feedback log:
    ${combinedFeedback}
    Update the profile with any new learned preferences based on the feedback above.
    Keep the existing structure and only add or refine relevant sections. Respond with the full updated profile.md content.
  `);

  console.log('\nProposed profile update:');
  console.log(updatedProfile);

  const approved = await confirm('Save this updated profile.md?');
  if (!approved) {
    console.log('Learn cancelled.');
    return;
  }

  await writeFile(getProfilePath(), updatedProfile);
  console.log('profile.md updated.');
}
