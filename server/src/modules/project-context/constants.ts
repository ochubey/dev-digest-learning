export {
  PROJECT_CONTEXT_FOLDERS,
  PROJECT_CONTEXT_MAX_DISCOVERED,
  PROJECT_CONTEXT_SOFT_CAP_TOKENS,
  PROJECT_CONTEXT_HARD_CEILING_TOKENS,
  PROJECT_CONTEXT_MAX_ATTACHED,
  PROJECT_CONTEXT_MAX_PATH_LENGTH,
} from '@devdigest/shared';

/** Parallel blob reads during discovery. */
export const DISCOVERY_READ_CONCURRENCY = 8;
/** Parallel blob reads at review-run time. */
export const RUN_READ_CONCURRENCY = 4;
/** Max entries in the blobSha -> token count cache. */
export const TOKEN_CACHE_SIZE = 2000;
