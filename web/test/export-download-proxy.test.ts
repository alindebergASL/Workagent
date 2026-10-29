/**
 * B3.0b regression: /v1/workspaces/:ws/exports/:exportId/download forwards
 * the exact export bytes for all four text formats (txt, markdown, csv,
 * json) with safe headers, never parses a JSON export as a DTO, and refuses
 * absent or stale page scopes before forwarding anything.
 */
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const A = "a".repeat(64);
const BEARER = "x".repeat(40);
const BACKEND = "http://127.0.0.1:18965";
const ORIGIN = "http://127.0.0.1:3195";
const browserScope = (backend: string, scope: string) =>
  createHmac("sha256", BEARER)
    .update(`workagent-web-scope/v1\n${backend}\n${scope}`)
    .digest("hex");
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const PATH = ["v1", "workspaces", "ws1", "exports", "e1", "download"];
const req = (headers: Record<string, string> = {}) =>
  [
    {
      method: "GET",
      headers: new Headers({
        host: "127.0.0.1:3195",
        "x-workagent-client": "local-ui",
        "x-workagent-scope": browserScope(BACKEND, A),
        ...headers,
      }),
      nextUrl: { search: "" },
      body: null,
      signal: new AbortController().signal,
    } as never,
    { params: Promise.resolve({ path: PATH }) },
  ] as const;
const forwarded = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter(([u]) => !String(u).endsWith("/v1/session"));

let upstream: ReturnType<typeof vi.fn>;
const serveExport = (
  bytes: Uint8Array,
  mime: string,
  filename: string,
  declared: string | null = sha256(bytes),
  contentType = `${mime}; charset=utf-8`,
) =>
  upstream.mockImplementation(async (url: string) =>
    String(url).endsWith("/v1/session")
      ? Response.json({ principal_id: "local-human", scope_id: A })
      : new Response(bytes.slice(), {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-disposition": `attachment; filename="${filename}"`,
            ...(declared === null ? {} : { "x-content-sha256": declared }),
          },
        }),
  );

beforeEach(() => {
  vi.stubEnv("LOCAL_TEST_MODE", "true");
  vi.stubEnv("LOCAL_BEARER_TOKEN", BEARER);
  vi.stubEnv("WORKAGENT_WEB_ORIGIN", ORIGIN);
  vi.stubEnv("WORKAGENT_BACKEND_URL", BACKEND);
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const mod = () => import("@/app/api/domain/[...path]/route");

const FORMATS: [mime: string, filename: string, body: string][] = [
  ["text/plain", "export.txt", "plain text export\n"],
  ["text/markdown", "export.md", "# heading\n\nmarkdown export\n"],
  ["text/markdown", "export.markdown", "long extension variant\n"],
  ["text/csv", "export.csv", "a,b\n1,2\n"],
  ["application/json", "export.json", '{"rows":[1,2]}\n'],
];

describe("export download proxy", () => {
  it("forwards exact bounded bytes with safe headers for every format", async () => {
    for (const [mime, filename, body] of FORMATS) {
      const bytes = new TextEncoder().encode(body);
      serveExport(bytes, mime, filename);
      const res = await (await mod()).GET(...req());
      expect(res.status, filename).toBe(200);
      const got = new Uint8Array(await res.arrayBuffer());
      expect(got, filename).toEqual(bytes);
      expect(res.headers.get("content-type")).toBe(mime);
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="${filename}"`,
      );
      expect(res.headers.get("content-length")).toBe(String(bytes.length));
      expect(res.headers.get("x-content-sha256")).toBe(sha256(bytes));
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never parses a JSON export as a DTO: malformed JSON bytes pass unchanged", async () => {
    const bytes = new TextEncoder().encode('{"truncated": [1, 2');
    serveExport(bytes, "application/json", "export.json");
    const res = await (await mod()).GET(...req());
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("refuses a mime/extension mismatch instead of forwarding it", async () => {
    serveExport(new TextEncoder().encode("x"), "text/plain", "export.md");
    const res = await (await mod()).GET(...req());
    expect(res.status).toBe(502);
  });

  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const XLSX =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  // Non-UTF-8 bytes (NUL, 0xff, a lone continuation byte) must pass verbatim.
  const binary = (magic: number[]) =>
    new Uint8Array([...magic, 0x00, 0xff, 0x80, 0xfe, 0x0a, 0x0d, 0x00]);
  const BINARIES: [mime: string, filename: string, bytes: Uint8Array][] = [
    [DOCX, "export.docx", binary([0x50, 0x4b, 0x03, 0x04])],
    [XLSX, "export.xlsx", binary([0x50, 0x4b, 0x03, 0x04])],
    ["application/pdf", "export.pdf", binary([0x25, 0x50, 0x44, 0x46, 0x2d])],
    ["image/png", "export.png", binary([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])],
  ];

  it("forwards exact binary office/chart bytes with their exact MIME and safe headers", async () => {
    for (const [mime, filename, bytes] of BINARIES) {
      // Backends send binaries without a charset parameter.
      serveExport(bytes, mime, filename, sha256(bytes), mime);
      const res = await (await mod()).GET(...req());
      expect(res.status, filename).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer()), filename).toEqual(bytes);
      expect(res.headers.get("content-type")).toBe(mime);
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="${filename}"`,
      );
      expect(res.headers.get("content-length")).toBe(String(bytes.length));
      expect(res.headers.get("x-content-sha256")).toBe(sha256(bytes));
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it.each([
    ["png bytes named .pdf", "image/png", "export.pdf"],
    ["docx under xlsx MIME", XLSX, "export.docx"],
    ["pdf under a text MIME", "text/plain", "export.pdf"],
    ["png under octet-stream", "application/octet-stream", "export.png"],
    ["text under a binary MIME", "application/pdf", "export.txt"],
    ["unlisted binary extension", "application/msword", "export.doc"],
    ["executable extension", "application/octet-stream", "export.exe"],
  ])("refuses a binary MIME/extension mismatch: %s", async (_n, mime, name) => {
    const bytes = binary([0x89, 0x50, 0x4e, 0x47]);
    serveExport(bytes, mime, name, sha256(bytes), mime);
    const res = await (await mod()).GET(...req());
    expect(res.status).toBe(502);
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("refuses binary bytes that do not match the declared digest", async () => {
    const bytes = binary([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const other = sha256(binary([0x25, 0x50, 0x44, 0x46, 0x2e]));
    serveExport(
      bytes,
      "application/pdf",
      "export.pdf",
      other,
      "application/pdf",
    );
    const res = await (await mod()).GET(...req());
    expect(res.status).toBe(502);
  });

  it("keeps the 1 MiB cap for binary exports", async () => {
    const at = new Uint8Array(1024 * 1024).fill(0xff);
    serveExport(at, "image/png", "export.png", sha256(at), "image/png");
    expect((await (await mod()).GET(...req())).status).toBe(200);
    const over = new Uint8Array(1024 * 1024 + 1).fill(0xff);
    serveExport(over, "image/png", "export.png", sha256(over), "image/png");
    expect((await (await mod()).GET(...req())).status).toBe(502);
  });

  it("refuses an unsafe content-disposition", async () => {
    serveExport(
      new TextEncoder().encode("x"),
      "text/plain",
      '..\\evil"; dummy="a.txt',
    );
    const res = await (await mod()).GET(...req());
    expect(res.status).toBe(502);
  });

  it("refuses bytes that do not match the backend's declared digest", async () => {
    serveExport(
      new TextEncoder().encode("tampered"),
      "text/plain",
      "export.txt",
      "f".repeat(64),
    );
    const res = await (await mod()).GET(...req());
    expect(res.status).toBe(502);
  });

  it("absent or stale page scope is refused before anything is forwarded", async () => {
    serveExport(new TextEncoder().encode("secret"), "text/plain", "export.txt");
    for (const headers of [
      { "x-workagent-scope": "" },
      { "x-workagent-scope": browserScope(BACKEND, "b".repeat(64)) },
      { "x-workagent-scope": A },
    ]) {
      upstream.mockClear();
      const res = await (await mod()).GET(...req(headers));
      expect(res.status).toBe(401);
      expect(res.headers.get("x-workagent-identity")).toBe("unconfirmed");
      expect(await res.text()).not.toContain("secret");
      expect(forwarded(upstream)).toHaveLength(0);
    }
  });
});
