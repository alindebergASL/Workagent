import assert from "node:assert/strict";
import { test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sourceRefText } from "../src/lib/memory-contract";

test("memory provenance renders exact identity without source content", () => {
  assert.equal(
    sourceRefText({
      source_type: "memory",
      ref: {
        memory_id: "memory-a",
        revision_id: "revision-b",
        sha256: "a".repeat(64),
      },
    }),
    `Memory (memory_id: memory-a, revision_id: revision-b, sha256: ${"a".repeat(64)})`,
  );
});

test("existing file and external source formatting stays unchanged", () => {
  assert.equal(
    sourceRefText({
      source_type: "file",
      ref: {
        workspace_file_id: "file-a",
        version_id: "version-b",
        sha256: "b".repeat(64),
      },
    }),
    `Saved file (workspace_file_id: file-a, version_id: version-b, sha256: ${"b".repeat(64)})`,
  );
  assert.equal(
    sourceRefText({
      source_type: "source",
      ref: {
        source_id: "source-a",
        external_version: "version-c",
        observed_at: "2026-10-29T00:00:00Z",
      },
    }),
    "Source (source_id: source-a, external_version: version-c, observed_at: 2026-10-29T00:00:00Z)",
  );
});

test("the provenance text-child render is inert and omits payload extras", () => {
  const source = {
    source_type: "memory" as const,
    ref: {
      memory_id: "<script>unsafe()</script>",
      revision_id: "revision-b",
      sha256: "a".repeat(64),
      content: "PRIVATE_PAYLOAD_CANARY",
    },
    content: "PRIVATE_PAYLOAD_CANARY",
  };
  // Same React text-child sink used by MemoryPanel's provenance <li>.
  // This is a focused render check, not a mounted panel/browser journey.
  const html = renderToStaticMarkup(
    createElement("li", null, sourceRefText(source)),
  );
  assert.ok(html.includes("Memory (memory_id: &lt;script&gt;"));
  assert.ok(html.includes("revision_id: revision-b"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("PRIVATE_PAYLOAD_CANARY"));
  assert.ok(!html.includes("undefined"));
});
