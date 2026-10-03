/** Read a File's bytes as a base64 string (no data: URI prefix), for the
    `/skills/import/preview` and `/skills/import` JSON endpoints — the server
    has no `@fastify/multipart`, so file bytes travel as base64 in JSON
    rather than true multipart upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result as string;
      // "data:<mime>;base64,<payload>" — strip everything up to the comma.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** `.md` and `.zip` are both supported — the server dispatches on filename
    extension (see server's import.ts). A `.zip` must contain exactly one
    root-level `.md` file; that's validated server-side in the preview call. */
export function isSupportedImportFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".zip");
}
