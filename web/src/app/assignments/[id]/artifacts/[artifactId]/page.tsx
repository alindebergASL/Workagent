"use client";
import Link from "next/link";
import { WorkSurface } from "@/components/WorkSurface";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type {
  Artifact,
  ArtifactHistory,
  Block,
  Revision,
  SaveRevisionCommand,
  RequestRevisionCommand,
  ProposalDecisionCommand,
} from "@/lib/contract/types";
import { blocksEqual, countChanges, diffBlocks } from "@/lib/diff";
import { clearDraft, readDraft, writeDraft } from "@/lib/draft";
import { EXECUTION } from "@/lib/execution";
import { formatTime } from "@/lib/time";
import { DocDiff, DocEdit, DocRead } from "@/components/DocBody";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { SourcesDrawer } from "@/components/SourcesDrawer";
import {
  artifactStatus,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/ui";

type Mode = "read" | "edit" | "review" | "resolve";

interface SaveOutcome {
  kind: "idle" | "saving" | "saved" | "conflict" | "ambiguous" | "error";
  error?: unknown;
  newerCurrent?: Revision | null;
  at?: string;
}

/** Changes only when the accepted revision changes, so polling doesn't refetch history. */
function historyKeyForDiff(a: Artifact): string {
  return a.accepted_revision?.parent_revision_id ?? "root";
}

const KIND_LABEL: Record<Artifact["kind"], string> = {
  analysis: "Analysis",
  plan: "Plan",
  checklist: "Checklist",
};

export default function ArtifactPage() {
  const params = useParams<{ id: string; artifactId: string }>();
  const assignmentId = params.id;
  const artifactId = params.artifactId;
  const search = useSearchParams();
  const router = useRouter();
  const viewingRevision = search.get("revision_id");
  const { workspace, zone } = useWorkspace();
  const wsId = workspace?.id ?? null;

  const res = useResource<Artifact>(
    wsId
      ? `artifact:${wsId}:${artifactId}:${viewingRevision ?? "current"}`
      : null,
    (signal) => api.getArtifact(wsId!, artifactId, viewingRevision, signal),
    {
      pollMs: 2500,
      shouldPoll: (a) =>
        !a ||
        a.state === "generating" ||
        a.state === "queued" ||
        a.pending_proposal?.status === "generating",
    },
  );
  const art = res.data;
  // Parent revision bodies for "what changed"; refreshed whenever the accepted revision moves.
  const history = useResource<ArtifactHistory>(
    wsId && res.data?.accepted_revision_id
      ? `history:${wsId}:${artifactId}:${res.data.accepted_revision_id}:${historyKeyForDiff(res.data)}`
      : null,
    (signal) => api.getArtifactHistory(wsId!, artifactId, signal),
  );
  const current = art?.accepted_revision ?? null;
  const proposal = art?.pending_proposal ?? null;
  const isHistorical = Boolean(
    viewingRevision && current && art?.accepted_revision_id !== current.id,
  );

  const [mode, setMode] = useState<Mode>("read");
  const [draft, setDraft] = useState<Block[] | null>(null);
  const [draftBase, setDraftBase] = useState<string | null>(null);
  const [save, setSave] = useState<SaveOutcome>({ kind: "idle" });
  const [restorable, setRestorable] = useState<{
    body: Block[];
    base: string;
  } | null>(null);
  const [showProposalFull, setShowProposalFull] = useState(false);
  const [showCurrentFull, setShowCurrentFull] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceHighlight, setSourceHighlight] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState("0");
  const [agentFocus, setAgentFocus] = useState(0);
  const [workFocus, setWorkFocus] = useState(0);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const [instruction, setInstruction] = useState("");
  const [requestState, setRequestState] = useState<{
    busy: boolean;
    error?: unknown;
    done?: boolean;
  }>({ busy: false });
  const [decision, setDecision] = useState<{ busy: boolean; error?: unknown }>({
    busy: false,
  });
  const sourcesBtn = useRef<HTMLButtonElement>(null);
  const historyBtn = useRef<HTMLButtonElement>(null);
  const saveCommand = useRef<SaveRevisionCommand | null>(null);
  const revisionCommand = useRef<RequestRevisionCommand | null>(null);
  const decisionCommand = useRef<{
    operation: "accept" | "dismiss";
    proposalId: string;
    command: ProposalDecisionCommand;
  } | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const dirty = Boolean(draft && current && !blocksEqual(draft, current.body));

  // Offer to restore a per-tab draft backup after a reload.
  useEffect(() => {
    if (!art || draft) return;
    const rec = readDraft(art.id);
    if (rec && rec.body.length)
      setRestorable({ body: rec.body, base: rec.base_revision_id });
  }, [art, draft]);

  useEffect(() => {
    if (draft && draftBase && art)
      writeDraft({
        artifact_id: art.id,
        base_revision_id: draftBase,
        body: draft,
        saved_at: new Date().toISOString(),
      });
  }, [draft, draftBase, art]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // When access is lost, do not keep the draft around either.
  useEffect(() => {
    if (
      res.error?.code === "not_found_or_not_authorized" ||
      res.error?.code === "unauthenticated"
    ) {
      clearDraft(artifactId);
      setDraft(null);
    }
  }, [res.error, artifactId]);

  // Enter review mode automatically when a proposal needs a decision.
  useEffect(() => {
    if (!proposal) return;
    if (
      (proposal.status === "conflicted" || proposal.status === "proposed") &&
      mode === "read"
    )
      setMode("review");
  }, [proposal, mode]);

  const announce = (text: string) => {
    if (liveRef.current) liveRef.current.textContent = text;
  };

  const beginEdit = () => {
    if (!current) return;
    saveCommand.current = null;
    setDraft(current.body.map((b) => ({ ...b })));
    setDraftBase(current.id);
    setSave({ kind: "idle" });
    setMode("edit");
  };

  const discardDraft = () => {
    saveCommand.current = null;
    setDraft(null);
    setDraftBase(null);
    clearDraft(artifactId);
    setSave({ kind: "idle" });
    setMode(
      proposal &&
        (proposal.status === "conflicted" || proposal.status === "proposed")
        ? "review"
        : "read",
    );
  };

  const doSave = useCallback(
    async (opts: { resolvesProposalId?: string; note?: string } = {}) => {
      if (!wsId || !art || !draft || !draftBase || save.kind === "conflict")
        return;
      setSave({ kind: "saving" });
      try {
        if (!saveCommand.current) {
          // A fresh operation checks its base. Ambiguous retries replay the already-frozen command.
          const fresh = await api.getArtifact(wsId, art.id);
          if (fresh.accepted_revision_id !== draftBase) {
            res.set(fresh);
            setSave({
              kind: "conflict",
              newerCurrent: fresh.accepted_revision,
            });
            announce(
              "A newer version was saved. Your draft is kept; review before saving.",
            );
            return;
          }
          saveCommand.current = {
            command_id: newCommandId(),
            expected_current_revision_id: draftBase,
            body: structuredClone(draft),
            note:
              opts.note ??
              (mode === "resolve" && proposal
                ? `Resolved proposal ${proposal.id}`
                : undefined),
            resolves_proposal_id:
              opts.resolvesProposalId ??
              (mode === "resolve" ? proposal?.id : undefined),
          };
        }
        const result = await api.saveRevision(
          wsId,
          art.id,
          saveCommand.current,
        );
        saveCommand.current = null;
        clearDraft(art.id);
        setDraft(null);
        setDraftBase(null);
        res.set(result.artifact);
        setHistoryKey(String(Date.now()));
        setSave({ kind: "saved", at: result.revision.created_at });
        setMode(
          result.artifact.pending_proposal &&
            result.artifact.pending_proposal.status !== "generating"
            ? "review"
            : "read",
        );
        announce(`Saved as revision ${result.revision.sequence}.`);
      } catch (e) {
        if (e instanceof ApiError && e.isVersionConflict) {
          const details = e.versionConflict;
          setSave({
            kind: "conflict",
            newerCurrent: details?.current_revision ?? null,
            error: e,
          });
          saveCommand.current = null;
          await res.refresh();
          announce(
            "A newer version was saved. Your draft is kept; review before saving.",
          );
        } else if (e instanceof ApiError && e.isAmbiguousWrite) {
          setSave({ kind: "ambiguous", error: e });
          announce("Could not confirm the save. Your draft is kept.");
        } else {
          saveCommand.current = null;
          setSave({ kind: "error", error: e });
        }
      }
    },
    [wsId, art, draft, draftBase, res, save.kind, mode, proposal],
  );

  /** After an ambiguous write: read the artifact back and compare, instead of blindly sending a new command. */
  const reconcile = async () => {
    if (!wsId || !art || !draft) return;
    try {
      const fresh = await api.getArtifact(wsId, art.id);
      res.set(fresh);
      if (
        fresh.accepted_revision &&
        blocksEqual(fresh.accepted_revision.body, draft)
      ) {
        if (saveCommand.current?.resolves_proposal_id) {
          const history = await api.getArtifactHistory(wsId, art.id);
          const resolution = history.proposals.find(
            (p) => p.id === saveCommand.current?.resolves_proposal_id,
          );
          if (resolution?.status !== "declined") {
            setSave({
              kind: "ambiguous",
              error: new ApiError({
                code: "transport",
                status: 0,
                message:
                  "Your text is saved, but the proposal resolution is not confirmed. Retry the same save to finish that decision.",
              }),
            });
            return;
          }
        }
        saveCommand.current = null;
        clearDraft(art.id);
        setDraft(null);
        setDraftBase(null);
        setSave({ kind: "saved", at: fresh.accepted_revision.created_at });
        setMode("read");
        announce("The save had already been recorded.");
      } else {
        setSave({
          kind: "ambiguous",
          error: new ApiError({
            code: "transport",
            status: 0,
            message:
              "The original save is not confirmed. Retry the same save; its original base and decision remain unchanged.",
          }),
        });
      }
    } catch (e) {
      setSave({ kind: "ambiguous", error: e });
    }
  };

  const performDecision = async (operation: "accept" | "dismiss") => {
    if (
      !wsId ||
      !art ||
      !proposal ||
      !art.accepted_revision_id ||
      decision.busy
    )
      return;
    setDecision({ busy: true });
    try {
      if (
        decisionCommand.current &&
        decisionCommand.current.proposalId !== proposal.id
      ) {
        const history = await api.getArtifactHistory(wsId, art.id);
        const prior = history.proposals.find(
          (p) => p.id === decisionCommand.current?.proposalId,
        );
        if (!prior || !["accepted", "declined"].includes(prior.status))
          throw new ApiError({
            code: "action_unresolved",
            status: 409,
            message:
              "Check the prior decision in History before starting another.",
          });
        decisionCommand.current = null;
      }
      if (
        decisionCommand.current &&
        decisionCommand.current.operation !== operation
      )
        throw new ApiError({
          code: "transport",
          status: 0,
          message:
            "The prior decision is unconfirmed. Retry that same decision before changing intent.",
        });
      if (!decisionCommand.current)
        decisionCommand.current = {
          operation,
          proposalId: proposal.id,
          command: {
            command_id: newCommandId(),
            expected_current_revision_id: art.accepted_revision_id,
          },
        };
      const intent = decisionCommand.current;
      const result = await (
        intent.operation === "accept" ? api.acceptProposal : api.declineProposal
      )(wsId, art.id, intent.proposalId, intent.command);
      decisionCommand.current = null;
      res.set(result.artifact);
      setHistoryKey(String(Date.now()));
      setDecision({ busy: false });
      setMode("read");
      announce(
        operation === "accept"
          ? "Applied the proposal as a new revision."
          : "Kept your current version. The proposal remains in history.",
      );
    } catch (e) {
      if (!(e instanceof ApiError && e.isAmbiguousWrite))
        decisionCommand.current = null;
      setDecision({ busy: false, error: e });
      await res.refresh();
    }
  };
  const keepCurrent = () => performDecision("dismiss");
  const applyProposal = () => performDecision("accept");

  const beginResolve = (seed: "current" | "proposal") => {
    saveCommand.current = null;
    if (!current) return;
    const base =
      seed === "proposal" && proposal?.body ? proposal.body : current.body;
    setDraft(base.map((b) => ({ ...b })));
    setDraftBase(current.id);
    setSave({ kind: "idle" });
    setMode("resolve");
  };

  const sendRevisionRequest = async () => {
    if (!wsId || !art || !art.accepted_revision_id || !instruction.trim())
      return;
    setRequestState({ busy: true });
    try {
      if (!revisionCommand.current)
        revisionCommand.current = {
          command_id: newCommandId(),
          base_revision_id: art.accepted_revision_id,
          instruction: instruction.trim(),
        };
      await api.requestRevision(wsId, art.id, revisionCommand.current);
      revisionCommand.current = null;
      setRequestState({ busy: false, done: true });
      setInstruction("");
      setWorkFocus((n) => n + 1); // Phones: back to the document; the request waits for review.
      await res.refresh();
      announce(
        "Revision requested. You can keep editing; the proposal will wait for your review.",
      );
    } catch (e) {
      if (!(e instanceof ApiError && e.isAmbiguousWrite))
        revisionCommand.current = null;
      setRequestState({ busy: false, error: e });
    }
  };

  const openSource = (id: string) => {
    setSourceHighlight(id);
    setSourcesOpen(true);
  };

  const diffOps = useMemo(
    () =>
      current && proposal?.body ? diffBlocks(current.body, proposal.body) : [],
    [current, proposal],
  );
  const conflictDraftDiff = useMemo(
    () =>
      save.kind === "conflict" && save.newerCurrent && draft
        ? diffBlocks(save.newerCurrent.body, draft)
        : [],
    [save, draft],
  );

  // ---------- rendering ----------

  const back = (
    <Link className="back-link" href={`/assignments/${assignmentId}`}>
      ← Back to the assignment
    </Link>
  );

  if (res.error && !art) {
    return (
      <div className="agent-col">
        {back}
        <ErrorNotice
          error={res.error}
          actions={
            <Link className="btn btn-sm" href="/">
              Back to agent
            </Link>
          }
        />
      </div>
    );
  }
  if (!art) {
    return (
      <div className="agent-col" aria-busy="true">
        {back}
        <div className="skeleton" style={{ width: "30%" }} />
        <div className="skeleton" style={{ width: "60%", height: "2em" }} />
      </div>
    );
  }

  const status = artifactStatus(art.state, art.partial);
  const needsDecision = Boolean(
    proposal &&
    (proposal.status === "conflicted" || proposal.status === "proposed"),
  );
  const generating = proposal?.status === "generating";

  const saveStateText = (() => {
    switch (save.kind) {
      case "saving":
        return "Saving…";
      case "saved":
        return `Saved · revision ${current?.sequence ?? "?"} · ${formatTime(save.at ?? current?.created_at, zone)}`;
      default:
        if (dirty) return "Unsaved changes";
        if (current)
          return `Saved · revision ${current.sequence} · ${formatTime(current.created_at, zone)}`;
        return "Not saved yet";
    }
  })();

  // An accepted proposal is recorded as the person's decision; keep where its text came from.
  const appliedFrom = current
    ? (history.data?.proposals.find(
        (p) =>
          p.status === "accepted" && p.resolved_by_revision_id === current.id,
      ) ?? null)
    : null;

  const authorText = appliedFrom
    ? "Applied by you from Workagent’s proposal"
    : current
      ? current.author.kind === "human"
        ? `Edited by ${current.author.name === "You" ? "you" : current.author.name}`
        : `Prepared by the ${EXECUTION.worker}`
      : "Not prepared yet";

  const header = (
    <header className="doc-head">
      {back}
      <p className="eyebrow">
        {KIND_LABEL[art.kind]} · {workspace?.name ?? "Private"} · {authorText} ·
        observed {formatTime(res.observedAt ?? art.observed_at, zone)}
        {res.reconnecting ? " · reconnecting…" : ""}
      </p>
      <h1>{art.title}</h1>
      <div className="row row-between">
        <div className="row">
          {art.state !== "ready" || art.partial ? (
            <StatusBadge label={status.label} tone={status.tone} />
          ) : null}
          <span className="save-state" aria-live="polite">
            {saveStateText}
          </span>
        </div>
        <div className="row">
          <button
            ref={historyBtn}
            type="button"
            className="btn btn-sm btn-quiet-line"
            onClick={() => setHistoryOpen(true)}
          >
            History
          </button>
          <button
            ref={sourcesBtn}
            type="button"
            className="btn btn-sm btn-quiet-line"
            onClick={() => openSource("")}
          >
            Sources
          </button>
        </div>
      </div>
    </header>
  );

  const drawers = (
    <>
      <SourcesDrawer
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        assignmentId={assignmentId}
        highlightId={sourceHighlight}
        artifactTitles={{ [art.id]: art.title }}
        returnFocusTo={sourcesBtn}
      />
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        artifactId={art.id}
        refreshKey={historyKey}
        returnFocusTo={historyBtn}
        onView={(rid) => {
          setHistoryOpen(false);
          router.push(
            rid
              ? `/assignments/${assignmentId}/artifacts/${art.id}?revision_id=${encodeURIComponent(rid)}`
              : `/assignments/${assignmentId}/artifacts/${art.id}`,
          );
        }}
      />
      <div ref={liveRef} className="sr-only" role="status" aria-live="polite" />
    </>
  );

  // Generating / queued: never fabricate a body.
  if (!current) {
    return (
      <div className="doc-page">
        {header}
        <section className="doc-card">
          <p className="muted">
            {art.state === "queued"
              ? "This result is queued."
              : "This result is still being prepared."}{" "}
            Its body appears here once it is saved.
          </p>
        </section>
        {drawers}
      </div>
    );
  }

  if (isHistorical) {
    return (
      <div className="doc-page">
        {header}
        <Notice
          tone="notice-warn"
          title={`Viewing revision ${current.sequence} (not the current version)`}
          role="status"
          actions={
            <Link
              className="btn btn-sm"
              href={`/assignments/${assignmentId}/artifacts/${art.id}`}
            >
              Show current version
            </Link>
          }
        >
          {current.author.kind === "human" ? "You" : "Workagent"} ·{" "}
          {formatTime(current.created_at, zone)} · {current.id}. Viewing does
          not change the current version. To bring this text back, open the
          current version, edit and save.
        </Notice>
        <section className="doc-card">
          <DocRead
            blocks={current.body}
            onSourceMark={openSource}
            idPrefix={current.id}
          />
        </section>
        {drawers}
      </div>
    );
  }

  const restoreBanner =
    restorable && !draft && mode !== "resolve" ? (
      <Notice
        tone="notice-warn"
        title="You have an unsaved draft from earlier"
        role="status"
        actions={
          <>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setDraft(restorable.body);
                setDraftBase(restorable.base);
                setRestorable(null);
                setMode("edit");
                if (restorable.base !== current.id)
                  setSave({ kind: "conflict", newerCurrent: current });
              }}
            >
              Resume editing
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                clearDraft(art.id);
                setRestorable(null);
              }}
            >
              Discard draft
            </button>
          </>
        }
      >
        {restorable.base === current.id
          ? "It was based on the current version."
          : `It was based on an older revision (${restorable.base}); the current version is ${current.id}. Both stay available.`}
      </Notice>
    ) : null;

  const saveNotices = (
    <>
      {save.kind === "conflict" ? (
        <Notice
          tone="notice-warn"
          title="A newer version was saved while you were editing"
          role="alert"
        >
          Your draft is kept and nothing was overwritten. The current version is
          now revision {save.newerCurrent?.sequence ?? "?"} (
          {art.accepted_revision_id}).
          {conflictDraftDiff.length ? (
            <details className="disclosure" style={{ marginTop: 8 }}>
              <summary>Compare your draft with the current version</summary>
              <div className="disclosure-body">
                <DocDiff
                  ops={conflictDraftDiff}
                  labels={{
                    added: "Only in your draft",
                    removed: "Only in the saved version",
                    tone: "compare",
                  }}
                />
              </div>
            </details>
          ) : null}
          <div className="notice-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setDraftBase(art.accepted_revision_id);
                setSave({ kind: "idle" });
                announce(
                  `Continuing your draft on top of revision ${save.newerCurrent?.sequence ?? ""}.`,
                );
              }}
            >
              Continue my draft on top of the current version
            </button>
            <button type="button" className="btn btn-sm" onClick={discardDraft}>
              Discard my draft
            </button>
          </div>
        </Notice>
      ) : null}
      {save.kind === "ambiguous" ? (
        <Notice
          tone="notice-error"
          title="Couldn’t confirm whether the save went through"
          role="alert"
          actions={
            <>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void reconcile()}
              >
                Check the saved version
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void doSave()}
              >
                Retry the same save
              </button>
            </>
          }
        >
          {save.error instanceof Error ? save.error.message + " " : ""}
          Your complete save intent is kept, including any proposal decision.
          Checking first avoids saving the same change twice.
        </Notice>
      ) : null}
      {save.kind === "error" ? (
        <ErrorNotice
          error={save.error}
          actions={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void doSave()}
            >
              Try again
            </button>
          }
        />
      ) : null}
    </>
  );

  // ---------- resolution editor ----------
  if (mode === "resolve" && draft && proposal) {
    return (
      <div className="doc-page">
        {header}
        <Notice
          title={`Resolving the proposal based on revision ${proposal.base_sequence}`}
          role="status"
        >
          Edit the text below into the version you want to keep. Saving checks
          the current revision again; if something else was saved meanwhile you
          return here with your draft intact.
        </Notice>
        {saveNotices}
        <div className="conflict-grid">
          <section
            className="conflict-pane"
            data-role="current"
            aria-labelledby="resolve-edit-title"
          >
            <header>
              <h2 id="resolve-edit-title">Your resolution</h2>
              <span className="ids">
                Will be saved as a new revision on top of revision{" "}
                {current.sequence} ({current.id})
              </span>
            </header>
            <DocEdit
              blocks={draft}
              onChange={setDraft}
              disabled={save.kind === "saving" || save.kind === "ambiguous"}
            />
          </section>
          <section
            className="conflict-pane"
            aria-labelledby="resolve-prop-title"
          >
            <header>
              <h2 id="resolve-prop-title">Agent proposal (for reference)</h2>
              <span className="ids">
                Based on revision {proposal.base_sequence} (
                {proposal.base_revision_id}) · {proposal.id}
              </span>
            </header>
            <details className="disclosure" open>
              <summary>
                How the proposal differs from the current version
              </summary>
              <div className="disclosure-body">
                <DocDiff
                  ops={diffOps}
                  labels={{
                    added: "Only in the proposal",
                    removed: "Only in your saved version",
                    tone: "compare",
                  }}
                />
              </div>
            </details>
            <div className="row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => beginResolve("proposal")}
              >
                Start from the proposal instead
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => beginResolve("current")}
              >
                Start from the current version
              </button>
            </div>
          </section>
        </div>
        <div className="action-bar">
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void doSave({
                  resolvesProposalId: proposal.id,
                  note: `Resolved proposal ${proposal.id}`,
                })
              }
              disabled={
                save.kind === "saving" ||
                save.kind === "ambiguous" ||
                save.kind === "conflict"
              }
            >
              {save.kind === "saving" ? "Saving…" : "Save resolution"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={discardDraft}
              disabled={save.kind === "saving" || save.kind === "ambiguous"}
            >
              Back to review
            </button>
          </div>
          <span className="small muted">
            Checks revision {current.sequence} again before saving
          </span>
        </div>
        {drawers}
      </div>
    );
  }

  // ---------- decision: review a proposal ----------
  if (mode === "review" && needsDecision && proposal?.body) {
    const stale = proposal.status === "conflicted";
    const { added, removed } = countChanges(diffOps);
    const reason = proposal.reason.trim().replace(/[.!?]+$/, "");
    return (
      <div className="doc-page">
        {header}
        {restoreBanner}
        <section
          className="decision-card decision-card-wide"
          aria-labelledby="decision-title"
        >
          <p className="eyebrow-caps">Your decision</p>
          <h2 id="decision-title">
            {stale
              ? `I proposed this before you saved revision ${current.sequence}. Your version is unchanged.`
              : `I’ve proposed a change to revision ${current.sequence}. Nothing is applied until you decide.`}
          </h2>
          <p>
            Requested: “{reason}”.{" "}
            {stale
              ? "It can’t be applied over your newer edit; keep your version, or review the changes and save your own resolution."
              : "Apply it as a new revision, keep your version, or review the changes yourself."}
          </p>
          <p className="ids">
            Base {proposal.base_revision_id} · current {current.id} · proposal{" "}
            {proposal.id} · prepared by the {EXECUTION.worker}
          </p>
        </section>
        {decision.error ? <ErrorNotice error={decision.error} /> : null}
        <details className="disclosure exact-changes" open>
          <summary>
            {stale
              ? `Differences · ${added} only in the proposal, ${removed} only in your version`
              : `Exact changes · ${added} added, ${removed} removed`}
          </summary>
          <div className="disclosure-body">
            <DocDiff
              ops={diffOps}
              labels={
                stale
                  ? {
                      added: "Only in the proposal",
                      removed: "Only in your saved version",
                      tone: "compare",
                    }
                  : {
                      added: "Added if applied",
                      removed: "Removed if applied",
                      tone: "edit",
                    }
              }
            />
          </div>
        </details>
        <div className="conflict-grid">
          <ConflictPane
            role="current"
            title="Current saved version"
            ids={`Revision ${current.sequence} · ${current.id} · ${current.author.kind === "human" ? "edited by you" : `prepared by the ${EXECUTION.worker}`} · ${formatTime(current.created_at, zone)}`}
            body={current.body}
            expanded={showCurrentFull}
            onToggle={() => setShowCurrentFull((v) => !v)}
            onSourceMark={openSource}
          />
          <ConflictPane
            role="proposal"
            title={`Agent proposal based on revision ${proposal.base_sequence}`}
            ids={`${proposal.id} · based on ${proposal.base_revision_id} · ${formatTime(proposal.updated_at, zone)}`}
            body={proposal.body}
            expanded={showProposalFull}
            onToggle={() => setShowProposalFull((v) => !v)}
            onSourceMark={openSource}
          />
        </div>
        <div className="action-bar">
          <div className="row">
            {stale ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void keepCurrent()}
                  disabled={decision.busy}
                >
                  Keep current version
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => beginResolve("current")}
                  disabled={decision.busy}
                >
                  Review changes
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void applyProposal()}
                  disabled={decision.busy}
                >
                  Apply proposal
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void keepCurrent()}
                  disabled={decision.busy}
                >
                  Keep current version
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => beginResolve("current")}
                  disabled={decision.busy}
                >
                  Review changes
                </button>
              </>
            )}
          </div>
          <span className="small muted">
            Either way, both versions stay in History.
          </span>
        </div>
        {drawers}
      </div>
    );
  }

  // ---------- working view: document + agent ----------
  const editing = mode === "edit" && Boolean(draft);
  const parent = current.parent_revision_id
    ? history.data?.revisions.find((r) => r.id === current.parent_revision_id)
    : null;
  const lastChange = parent ? diffBlocks(parent.body, current.body) : [];
  const changedCount = lastChange.filter((o) => o.type !== "same").length;

  const agentPane = (
    <div className="agent-pane stack-lg stack">
      <div className="agent-say">
        <div className="agent-presence agent-presence-xs" aria-hidden="true" />
        <p>
          {generating
            ? `I’m drafting a revision from revision ${proposal?.base_sequence ?? current.sequence} with the ${EXECUTION.worker}. Keep working; it will wait for your review and never replaces your saved text on its own.`
            : appliedFrom
              ? `You applied my proposal as revision ${current.sequence}: “${appliedFrom.reason.trim().replace(/[.!?]+$/, "")}”. Your earlier text stays where I didn’t change it.`
              : current.author.kind === "human"
                ? `Your edits are saved as revision ${current.sequence}. I’ll work from this version.`
                : `Here’s the ${art.title.toLowerCase()}. Your changes stay with the page; anything I propose waits for you.`}
        </p>
      </div>
      {art.partial ? (
        <p className="hint" role="status">
          Partial result: this is what has been saved so far.
        </p>
      ) : null}

      <section className="stack" aria-labelledby="changes-title">
        <h2 id="changes-title" className="section-title">
          {parent
            ? `What changed in revision ${current.sequence}`
            : "First version"}
        </h2>
        {parent ? (
          <details className="disclosure">
            <summary>
              {changedCount
                ? `${changedCount} line${changedCount === 1 ? "" : "s"} changed from revision ${parent.sequence} · ${appliedFrom ? "applied from my proposal" : current.author.kind === "human" ? "by you" : "by Workagent"}`
                : "No changes to the text or checklist"}
            </summary>
            <div className="disclosure-body">
              <DocDiff
                ops={lastChange}
                labels={{
                  added: `Added in revision ${current.sequence}`,
                  removed: `Removed in revision ${current.sequence}`,
                  tone: "edit",
                }}
              />
            </div>
          </details>
        ) : (
          <p className="small muted">
            Prepared from {art.source_refs.length} source
            {art.source_refs.length === 1 ? "" : "s"} by the {EXECUTION.worker}.{" "}
            <button
              type="button"
              className="link-quiet"
              onClick={() => setHistoryOpen(true)}
            >
              See history
            </button>
          </p>
        )}
      </section>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          void sendRevisionRequest();
        }}
      >
        <label htmlFor="instruction" className="section-title">
          What should change?
        </label>
        <textarea
          id="instruction"
          ref={instructionRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={
            requestState.busy ||
            Boolean(revisionCommand.current) ||
            Boolean(proposal)
          }
          rows={3}
          placeholder="For example: add a default owner so no case is saved blank."
        />
        <p className="hint">
          {proposal
            ? "A proposal for this page is already in progress or waiting for you."
            : `Sent with revision ${current.sequence} as the base. The result waits for your review.`}
        </p>
        {requestState.error ? <ErrorNotice error={requestState.error} /> : null}
        <div className="row">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={
              !instruction.trim() || requestState.busy || Boolean(proposal)
            }
          >
            {requestState.busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </div>
  );

  const documentPane = (
    <section className="doc-card" aria-labelledby="doc-card-title">
      <div className="doc-card-bar">
        <span id="doc-card-title">
          {KIND_LABEL[art.kind]} · revision {current.sequence}
          {editing ? " · editing" : ""}
        </span>
        <span>{dirty ? "Unsaved changes" : "Private · saved"}</span>
      </div>
      {editing && draft ? (
        <>
          <h2 className="sr-only">Edit {art.title}</h2>
          <DocEdit
            blocks={draft}
            onChange={setDraft}
            disabled={save.kind === "saving" || save.kind === "ambiguous"}
          />
          <div className="doc-card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void doSave()}
              disabled={
                !dirty ||
                save.kind === "saving" ||
                save.kind === "conflict" ||
                save.kind === "ambiguous"
              }
            >
              {save.kind === "saving" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={discardDraft}
              disabled={save.kind === "saving" || save.kind === "ambiguous"}
            >
              {dirty ? "Discard changes" : "Stop editing"}
            </button>
            <span className="small muted">
              Based on saved revision {draftBase}
            </span>
          </div>
        </>
      ) : (
        <>
          <DocRead
            blocks={current.body}
            onSourceMark={openSource}
            idPrefix={current.id}
          />
          <div className="doc-card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={beginEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAgentFocus((n) => n + 1);
                window.setTimeout(() => instructionRef.current?.focus(), 0);
              }}
              disabled={Boolean(proposal)}
            >
              Request revision
            </button>
            <span className="small muted mono">
              {current.id} · {current.body_hash.slice(0, 19)}…
            </span>
          </div>
        </>
      )}
    </section>
  );

  return (
    <div className="doc-page">
      {header}
      {restoreBanner}
      {saveNotices}
      {save.kind === "saved" && !editing ? (
        <Notice tone="notice-ok" role="status">
          Saved as revision {current.sequence}.
        </Notice>
      ) : null}
      {generating ? (
        <Notice role="status" title="A revision is being drafted">
          Based on revision {proposal?.base_sequence}, by the {EXECUTION.worker}
          . You can keep editing; a proposal never replaces your saved version
          without your decision.
        </Notice>
      ) : null}
      <WorkSurface
        document={documentPane}
        agent={agentPane}
        focusAgent={agentFocus}
        focusWork={workFocus}
      />
      {drawers}
    </div>
  );
}

function ConflictPane({
  role,
  title,
  ids,
  body,
  expanded,
  onToggle,
  onSourceMark,
}: {
  role: "current" | "proposal";
  title: string;
  ids: string;
  body: Block[];
  expanded: boolean;
  onToggle: () => void;
  onSourceMark: (id: string) => void;
}) {
  const long = body.length > 10;
  return (
    <section
      className="conflict-pane"
      data-role={role}
      aria-labelledby={`pane-${role}`}
    >
      <header>
        <h2 id={`pane-${role}`}>{title}</h2>
        <span className="ids">{ids}</span>
      </header>
      <div className={long && !expanded ? "clamp" : undefined}>
        <DocRead blocks={body} onSourceMark={onSourceMark} idPrefix={role} />
      </div>
      {long ? (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Show full text"}
        </button>
      ) : null}
    </section>
  );
}
