import { describe, expect, it } from "vitest";
import { resultLink } from "../src/lib/result-links";
import { versionAuthor } from "../src/components/EarlierVersion";

const base = "/conversations/c";
const work = "/conversations/c/artifacts/a";
const doc = { artifact_id: "a", kind: "document" as const };
const proposal = (
  status: "pending" | "accepted" | "dismissed",
  over: Record<string, string | null> = {},
) => ({
  id: "p",
  status,
  base_revision_id: "r1",
  accepted_revision_id: null,
  ...over,
});

describe("result links say what the records say now", () => {
  it("claim nothing before the work is read", () => {
    expect(resultLink(base, { ...doc, proposal_id: "p" }, null)).toEqual({
      label: "Open document",
      href: work,
    });
  });
  it("a pending, current proposal asks for review", () => {
    const l = resultLink(
      base,
      { ...doc, proposal_id: "p" },
      {
        current_revision_id: "r1",
        proposal: proposal("pending"),
      },
    );
    expect(l.label).toBe("Review proposed change to the document");
  });
  it("a pending proposal on an older version is out of date", () => {
    const l = resultLink(
      base,
      { ...doc, proposal_id: "p" },
      {
        current_revision_id: "r2",
        proposal: proposal("pending"),
      },
    );
    expect(l.label).toBe("Open document");
    expect(l.note).toMatch(/out of date/);
  });
  it("an applied proposal that is still current says so", () => {
    const l = resultLink(
      base,
      { ...doc, proposal_id: "p" },
      {
        current_revision_id: "r2",
        proposal: proposal("accepted", { accepted_revision_id: "r2" }),
      },
    );
    expect(l.label).toBe("Open document");
    expect(l.note).toMatch(/applied and is the current version/);
    expect(l.label).not.toMatch(/proposed/);
  });
  it("an applied proposal edited since opens that version, with current beside", () => {
    const l = resultLink(
      base,
      { ...doc, proposal_id: "p" },
      {
        current_revision_id: "r3",
        proposal: proposal("accepted", { accepted_revision_id: "r2" }),
      },
    );
    expect(l).toEqual({
      label: "Open the applied version",
      href: `${work}?revision=r2`,
      note: "Applied, then changed since.",
      current: { label: "Open current document", href: work },
    });
  });
  it("a dismissed proposal opens current work, labelled as dismissed", () => {
    const l = resultLink(
      base,
      { ...doc, proposal_id: "p" },
      {
        current_revision_id: "r1",
        proposal: proposal("dismissed"),
      },
    );
    expect(l.label).toBe("Open current document");
    expect(l.note).toBe("This proposed change was dismissed.");
  });
  it("a saved result changed since opens its own version", () => {
    const l = resultLink(
      base,
      { ...doc, revision_id: "r1" },
      {
        current_revision_id: "r4",
      },
    );
    expect(l.href).toBe(`${work}?revision=r1`);
    expect(l.current?.href).toBe(work);
    expect(
      resultLink(
        base,
        { ...doc, revision_id: "r4" },
        {
          current_revision_id: "r4",
        },
      ),
    ).toEqual({ label: "Open document", href: work });
  });
});

describe("version authors come from the records", () => {
  const rev = (id: string, author_kind: "human" | "worker") =>
    ({ id, author_kind }) as Parameters<typeof versionAuthor>[0];
  it("an applied proposal is Workagent's change, applied by a person", () => {
    const accepted = [{ accepted_revision_id: "r2" }] as Parameters<
      typeof versionAuthor
    >[1];
    expect(versionAuthor(rev("r2", "human"), accepted)).toBe(
      "Workagent’s change, applied by you",
    );
    expect(versionAuthor(rev("r3", "human"), accepted)).toBe("your edit");
    expect(versionAuthor(rev("r1", "worker"), accepted)).toBe("Workagent");
  });
});
