// Defined next to the adapter so it never imports from modules/ci; re-exported for the ci module.
export { ArtifactTooLargeError } from '../../adapters/github-actions/types.js';
export type { ActionsRun, CiActionsSource } from '../../adapters/github-actions/types.js';
