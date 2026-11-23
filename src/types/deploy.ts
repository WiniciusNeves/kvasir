export type DeployTarget = 'expo' | 'web';

// What `kvasir deploy` can do for a project: EAS update/build/download/submit for Expo, build/Vercel/npm script for web.
export type DeployAction = 'eas-update' | 'eas-build' | 'eas-download' | 'eas-submit' | 'web-build' | 'vercel' | 'npm-deploy';

export interface EasBuildProfile {
  name: string;
  // the EAS Update channel builds of this profile listen to
  channel?: string;
  distribution?: string;
  // EAS environment (server-side env vars); `eas update` needs one from Expo SDK 55 on
  environment?: string;
}

export interface EasConfig {
  buildProfiles: EasBuildProfile[];
  submitProfiles: string[];
}

export interface DeployActionStatus {
  action: DeployAction;
  ready: boolean;
  // what is missing when it is not ready
  missing: string[];
}
