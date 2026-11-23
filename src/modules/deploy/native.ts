import { getChangedFilesSince, getFileAtRef, refExists } from '@utils/git';
import { readFile } from '@utils/fs';

// What changed since the last build that an OTA update cannot carry. Facts from git, no model: native
// folders and the app config are native for sure; a dependency change may or may not be (the developer
// knows if the lib has native code), so it is listed apart.

const NATIVE_PATHS = [/^android\//, /^ios\//, /^app\.json$/, /^app\.config\.(js|ts|mjs|cjs)$/];

export interface NativeChanges {
  // the build commit is not in this clone (shallow clone, other machine): nothing could be compared
  comparable: boolean;
  files: string[];
  dependencies: string[];
}

interface PackageDeps {
  dependencies?: Record<string, string>;
}

function parseDeps(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    return (JSON.parse(raw) as PackageDeps).dependencies ?? {};
  } catch {
    return {};
  }
}

export async function nativeChangesSince(commit: string): Promise<NativeChanges> {
  if (!refExists(commit)) return { comparable: false, files: [], dependencies: [] };

  const files = getChangedFilesSince(commit)
    .map((file) => file.path.split('\\').join('/'))
    .filter((path) => NATIVE_PATHS.some((pattern) => pattern.test(path)));

  const before = parseDeps(getFileAtRef(commit, 'package.json'));
  const now = parseDeps(await readFile('package.json'));
  const dependencies = [...new Set([...Object.keys(before), ...Object.keys(now)])]
    .filter((name) => before[name] !== now[name])
    .map((name) => (!before[name] ? `+${name}` : !now[name] ? `-${name}` : `${name} ${before[name]} → ${now[name]}`));

  return { comparable: true, files, dependencies };
}
