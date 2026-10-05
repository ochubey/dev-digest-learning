/**
 * GitHub HTTPS auth for git network operations WITHOUT putting the token in a URL.
 *
 * A token embedded in the clone URL (`https://x-access-token:TOKEN@github.com/...`) ends up in
 * the process arguments, in simple-git's error objects (and so in crash dumps / logs) and in the
 * clone's `.git/config` remote. Passing it as an `http.extraheader` instead keeps it out of all
 * of those: the URL stays plain and the header travels only in git's own `-c` config.
 */
const GITHUB_ORIGIN = 'https://github.com/';
const TOKEN_USERNAME = 'x-access-token';

/** simple-git `config` entries that authenticate requests to github.com with `token`. */
export function githubAuthConfig(token: string): string[] {
  const basic = Buffer.from(`${TOKEN_USERNAME}:${token}`).toString('base64');
  return [`http.${GITHUB_ORIGIN}.extraheader=AUTHORIZATION: basic ${basic}`];
}

/** `https://user:secret@host/x` -> `https://host/x` (anything else is returned unchanged). */
export function stripUrlCredentials(url: string): string {
  try {
    const u = new URL(url);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && (u.username || u.password)) {
      u.username = '';
      u.password = '';
      return u.toString();
    }
  } catch {
    /* not a URL (e.g. git@github.com:o/r.git, a local path): nothing to strip */
  }
  return url;
}
