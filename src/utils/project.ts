import path from 'path';

// The project a piece of learning belongs to: the folder the command runs in. Examples, feedback,
// knowledge notes and the per-project profile all key on it.
export function currentProject(): string {
  return path.basename(process.cwd());
}
