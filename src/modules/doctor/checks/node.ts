import { probe, firstVersion, majorOf } from './shared';
import type { ProjectPackageJson } from './shared';
import type { CheckResult } from '@ktypes/doctor';

// Minimal range check for "engines.node": >=X, >X, ^X, ~X, X, X.x and "a || b".
function satisfies(version: string, range: string): boolean {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);

  return range.split('||').some((part) =>
    part
      .trim()
      .split(/\s+/)
      .every((condition) => {
        const match = condition.match(/^(>=|>|<=|<|\^|~)?v?(\d+)(?:\.(\d+|x))?/);
        if (!match) return true;
        const [, operator = '', wantMajorText, wantMinorText] = match;
        const wantMajor = Number(wantMajorText);
        const wantMinor = wantMinorText && wantMinorText !== 'x' ? Number(wantMinorText) : 0;
        const compare = major !== wantMajor ? major - wantMajor : minor - wantMinor;

        if (operator === '>=') return compare >= 0;
        if (operator === '>') return compare > 0;
        if (operator === '<=') return compare <= 0;
        if (operator === '<') return compare < 0;
        if (operator === '~') return major === wantMajor && minor === wantMinor;
        return major === wantMajor && (operator === '^' ? compare >= 0 : true);
      })
  );
}

export function checkNode(pkg: ProjectPackageJson | null): CheckResult[] {
  const version = process.version;
  const range = pkg?.engines?.node;
  const results: CheckResult[] = [];

  if (!range) {
    results.push({ name: 'Node', status: majorOf(version) >= 18 ? 'ok' : 'fail', detail: `${version} (o Kvasir precisa de >= 18)`, fix: 'Instale o Node 18 ou mais novo (nodejs.org ou nvm)' });
  } else if (satisfies(version, range)) {
    results.push({ name: 'Node', status: 'ok', detail: `${version} (projeto pede ${range})` });
  } else {
    results.push({ name: 'Node', status: 'fail', detail: `${version}, mas o projeto pede ${range}`, fix: `Use uma versão que atenda "${range}" (ex.: nvm install / nvm use)` });
  }

  const npm = probe('npm', ['-v']);
  results.push(npm.found ? { name: 'npm', status: 'ok', detail: firstVersion(npm.output) ?? npm.output } : { name: 'npm', status: 'fail', detail: 'não encontrado', fix: 'Reinstale o Node (o npm vem junto)' });

  const yarn = probe('yarn', ['-v']);
  if (yarn.found) results.push({ name: 'yarn', status: 'ok', detail: firstVersion(yarn.output) ?? yarn.output });

  return results;
}
