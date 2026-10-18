import path from 'path';
import fs from 'fs-extra';
import { probe, firstVersion, majorOf, hasDependency } from './shared';
import type { ProjectPackageJson } from './shared';
import type { CheckResult } from '@ktypes/doctor';

// React Native 0.73+ / Expo SDK 50+ build with JDK 17.
const RECOMMENDED_JDK = 17;

function checkJdk(): CheckResult[] {
  const java = probe('java', ['-version']);
  if (!java.found) {
    return [{ name: 'JDK', status: 'fail', detail: 'java não encontrado', fix: `Instale o JDK ${RECOMMENDED_JDK} (ex.: Eclipse Temurin) e configure JAVA_HOME` }];
  }

  const version = firstVersion(java.output) ?? '?';
  const major = version === '?' ? 0 : majorOf(version.startsWith('1.') ? version.slice(2) : version);
  const results: CheckResult[] = [
    major === RECOMMENDED_JDK
      ? { name: 'JDK', status: 'ok', detail: version }
      : { name: 'JDK', status: 'warn', detail: `${version} (recomendado: ${RECOMMENDED_JDK})`, fix: `Instale o JDK ${RECOMMENDED_JDK} e aponte JAVA_HOME e o PATH para ele` },
  ];

  // Gradle uses JAVA_HOME; the terminal uses the java on PATH. Different JDKs = builds that behave differently.
  const javaHome = process.env.JAVA_HOME;
  if (!javaHome) {
    results.push({ name: 'JAVA_HOME', status: 'warn', detail: 'não definido', fix: 'Defina JAVA_HOME com a pasta do JDK' });
  } else if (!fs.pathExistsSync(javaHome)) {
    results.push({ name: 'JAVA_HOME', status: 'fail', detail: `${javaHome} não existe`, fix: 'Corrija JAVA_HOME para a pasta de um JDK instalado' });
  } else {
    const homeJava = probe(path.join(javaHome, 'bin', 'java'), ['-version']);
    const homeVersion = homeJava.found ? firstVersion(homeJava.output) : null;
    results.push(
      homeVersion && homeVersion !== version
        ? { name: 'JAVA_HOME', status: 'warn', detail: `JDK ${homeVersion}, mas o "java" do PATH é ${version}`, fix: 'Coloque %JAVA_HOME%\\bin no início do PATH para usar o mesmo JDK' }
        : { name: 'JAVA_HOME', status: 'ok', detail: javaHome }
    );
  }

  return results;
}

function checkAndroidSdk(): CheckResult[] {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const results: CheckResult[] = [];

  if (!sdk) {
    results.push({ name: 'ANDROID_HOME', status: 'fail', detail: 'não definido', fix: 'Instale o Android Studio e defina ANDROID_HOME com a pasta do SDK' });
  } else if (!fs.pathExistsSync(sdk)) {
    results.push({ name: 'ANDROID_HOME', status: 'fail', detail: `${sdk} não existe`, fix: 'Corrija ANDROID_HOME para a pasta do Android SDK' });
  } else {
    results.push({ name: 'ANDROID_HOME', status: 'ok', detail: sdk });
  }

  const adb = probe('adb', ['--version']);
  results.push(
    adb.found
      ? { name: 'adb', status: 'ok', detail: firstVersion(adb.output) ?? 'ok' }
      : { name: 'adb', status: 'warn', detail: 'não está no PATH', fix: 'Adicione %ANDROID_HOME%\\platform-tools ao PATH' }
  );

  const gradlew = path.resolve(process.cwd(), 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (fs.pathExistsSync(path.resolve(process.cwd(), 'android'))) {
    results.push(
      fs.pathExistsSync(gradlew)
        ? { name: 'Gradle wrapper', status: 'ok', detail: path.relative(process.cwd(), gradlew) }
        : { name: 'Gradle wrapper', status: 'fail', detail: 'android/ existe mas sem gradlew', fix: 'Rode "npx expo prebuild" ou restaure o gradlew do template' }
    );
  }

  return results;
}

function checkExpo(pkg: ProjectPackageJson | null): CheckResult[] {
  const results: CheckResult[] = [];
  const expoVersion = pkg?.dependencies?.expo ?? pkg?.devDependencies?.expo;
  if (expoVersion) results.push({ name: 'Expo SDK', status: 'ok', detail: `expo@${expoVersion} (o CLI vem com o pacote: npx expo)` });

  const eas = probe('eas', ['--version']);
  if (!eas.found) {
    results.push({ name: 'EAS CLI', status: 'warn', detail: 'não instalado', fix: 'npm install -g eas-cli' });
    return results;
  }

  const version = eas.output.match(/eas-cli\/(\d+\.\d+\.\d+)/)?.[1] ?? firstVersion(eas.output) ?? '?';
  const outdated = /is now available/i.test(eas.output);
  results.push(
    outdated
      ? { name: 'EAS CLI', status: 'warn', detail: `${version} (há versão nova)`, fix: 'npm install -g eas-cli' }
      : { name: 'EAS CLI', status: 'ok', detail: version }
  );

  const whoami = probe('eas', ['whoami']);
  const account = whoami.output.split('\n').map((line) => line.trim()).find((line) => line && !/available|npm install|★/i.test(line));
  results.push(
    whoami.exitCode === 0 && account && !/not logged in/i.test(whoami.output)
      ? { name: 'EAS login', status: 'ok', detail: account }
      : { name: 'EAS login', status: 'warn', detail: 'não logado', fix: 'eas login' }
  );

  return results;
}

export function isMobileProject(pkg: ProjectPackageJson | null): boolean {
  return hasDependency(pkg, 'expo') || hasDependency(pkg, 'react-native');
}

export function checkMobile(pkg: ProjectPackageJson | null): CheckResult[] {
  return [...checkJdk(), ...checkAndroidSdk(), ...checkExpo(pkg)];
}
