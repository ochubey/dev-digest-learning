/** Small LRU: blob sha -> token count. A blob sha is content-addressed, so entries never go stale. */
export class TokenCache {
  private map = new Map<string, number>();

  constructor(private max: number) {}

  get(blobSha: string): number | undefined {
    const v = this.map.get(blobSha);
    if (v === undefined) return undefined;
    this.map.delete(blobSha);
    this.map.set(blobSha, v);
    return v;
  }

  set(blobSha: string, tokens: number): void {
    this.map.delete(blobSha);
    this.map.set(blobSha, tokens);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
