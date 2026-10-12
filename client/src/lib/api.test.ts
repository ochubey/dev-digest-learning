import { describe, it, expect, afterEach, vi } from "vitest";
import { apiFetch, ApiError } from "./api";

const respond = (status: number, statusText: string, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, statusText })),
  );

afterEach(() => vi.unstubAllGlobals());

const failure = async (path = "/x") => (await apiFetch(path).catch((e) => e)) as ApiError;

describe("apiFetch error messages", () => {
  it("uses a string `error` body as the message and keeps retry_after", async () => {
    respond(502, "Bad Gateway", { error: "Risk Brief model is not configured", retry_after: 3 });
    const err = await failure();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Risk Brief model is not configured");
    expect(err.status).toBe(502);
    expect(err.details).toEqual({ retry_after: 3 });
  });

  it("keeps the envelope handling", async () => {
    respond(400, "Bad Request", { error: { code: "bad", message: "nope", details: { a: 1 } } });
    const err = await failure();
    expect([err.message, err.code, err.details]).toEqual(["nope", "bad", { a: 1 }]);
  });

  it("falls back to the status text without an error body", async () => {
    respond(502, "Bad Gateway", {});
    expect((await failure()).message).toBe("502 Bad Gateway");
  });
});
