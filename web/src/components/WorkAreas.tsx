"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_MODE } from "@/lib/client/api";
import { productApi, isProduct } from "@/lib/client/products";
import { isFlexible } from "@/lib/flexible";
import { ReadOnly } from "./FlexibleWork";
import { ProductView } from "./ProductView";
import "./SpaceWork.css";
import { useResource } from "@/lib/client/hooks";
import {
  areaHref,
  workAreas,
  type AreaInput,
  type WorkArea,
} from "@/lib/client/work-areas";
import { ErrorNotice } from "./ui";

function AreaForm({
  initial,
  submit,
  label,
}: {
  initial?: AreaInput;
  submit: (input: AreaInput) => Promise<void>;
  label: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [kind, setKind] = useState<AreaInput["kind"]>(
    initial?.kind ?? "project",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // No automatic retry after a possibly committed write. Read the list/detail
  // before submitting a fresh command; the HTTP client does not retry writes.
  const [attempted, setAttempted] = useState(false);
  return (
    <form
      className="stack-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || attempted) return;
        setBusy(true);
        setAttempted(true);
        try {
          await submit({ title, goal, kind });
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Space title
        <input
          required
          maxLength={240}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Goal
        <textarea
          aria-label="Goal"
          required
          maxLength={2000}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <label>
        Kind
        <select
          aria-label="Space kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AreaInput["kind"])}
        >
          <option value="project">Project</option>
          <option value="workflow">Workflow</option>
        </select>
      </label>
      <button
        className="btn"
        disabled={busy || attempted || !title.trim() || !goal.trim()}
      >
        {busy ? "Saving…" : label}
      </button>
      {error ? (
        <>
          <ErrorNotice error={error} />
          <p role="status">
            The write was not confirmed. Refresh and inspect saved Spaces before
            starting another command. Nothing is automatically resent.
          </p>
        </>
      ) : null}
    </form>
  );
}

export function WorkAreaList({ ws }: { ws: string }) {
  return API_MODE === "real" ? <RealWorkAreaList ws={ws} /> : null;
}

function RealWorkAreaList({ ws }: { ws: string }) {
  const router = useRouter();
  const res = useResource(`work-areas:${ws}`, (signal) =>
    workAreas.list(ws, signal),
  );
  const [creating, setCreating] = useState(false);
  return (
    <section className="stack" aria-label="Project and workflow Spaces">
      <div className="row wrap">
        <h2>Projects & workflows</h2>
        <button className="btn btn-sm" onClick={() => res.refresh()}>
          Refresh Spaces
        </button>
        <button className="btn btn-sm" onClick={() => setCreating(!creating)}>
          New Space
        </button>
      </div>
      {creating ? (
        <AreaForm
          label="Create Space"
          submit={async (input) => {
            const cv = await workAreas.create(ws, input, crypto.randomUUID());
            router.push(areaHref(ws, cv.id));
          }}
        />
      ) : null}
      {res.error ? <ErrorNotice error={res.error} /> : null}
      {res.loading ? <p role="status">Loading Spaces…</p> : null}
      <ul className="work-list">
        {res.data?.map((cv) => (
          <li key={cv.id}>
            <Link className="work-row" href={areaHref(ws, cv.id)}>
              <strong>{cv.work_area?.title}</strong>
              <span>{cv.work_area?.goal}</span>
              <span className="small muted">
                {cv.work_area?.kind} · {cv.state} ·{" "}
                {cv.work_area?.origin === "agent"
                  ? "Agent identified"
                  : "Human saved"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {res.data?.length === 0 ? (
        <p className="muted">
          No projects yet. Start with a request, or create a Space to keep
          ongoing work together. Ordinary chats stay chats.
        </p>
      ) : null}
    </section>
  );
}

export function SpaceWork({
  ws,
  id,
  artifactIds,
  versionKey,
}: {
  ws: string;
  id: string;
  artifactIds: string[];
  versionKey: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const res = useResource(`space-work:${ws}:${id}`, async (signal) =>
    Promise.all(
      artifactIds.map(async (aid) => {
        const [artifact, proposals] = await Promise.all([
          productApi.get(ws, aid, signal),
          productApi.proposals(ws, aid, signal),
        ]);
        return {
          artifact,
          pending: proposals.filter((p) => p.status === "pending").length,
        };
      }),
    ),
  );
  const refresh = res.refresh;
  const artifactsKey = artifactIds.join(",");
  useEffect(() => {
    void refresh();
  }, [refresh, versionKey, artifactsKey]);
  const lead =
    res.data?.find(({ artifact }) => artifact.id === selected) ?? res.data?.[0];
  if (!artifactIds.length) return null;
  return (
    <section className="card stack space-work" aria-label="Saved Space work">
      <div className="row">
        <h2>Saved work</h2>
        <button className="link-quiet small" onClick={() => void res.refresh()}>
          Refresh saved work
        </button>
        <a href="#follow-up" className="small">
          Talk about this Space ↓
        </a>
      </div>
      {res.error ? <ErrorNotice error={res.error} /> : null}
      {res.reconnecting ? (
        <p role="status">
          Saved work could not be refreshed. Showing the last read version.
        </p>
      ) : null}
      {res.loading ? <p role="status">Loading saved work…</p> : null}
      {res.data && res.data.length > 1 ? (
        <label>
          Work to read
          <select
            value={lead?.artifact.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {res.data.map(({ artifact, pending }) => (
              <option key={artifact.id} value={artifact.id}>
                {artifact.current_revision.body.title}
                {pending ? ` · ${pending} pending` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {lead ? (
        <article
          className="stack-sm"
          data-artifact-id={lead.artifact.id}
          data-revision-id={lead.artifact.current_revision_id}
        >
          <h3>
            <Link href={`/conversations/${id}/artifacts/${lead.artifact.id}`}>
              {lead.artifact.current_revision.body.title}
            </Link>
          </h3>
          <p className="hint">Current saved version · read-only here</p>
          <div className="row">
            <Link
              className="btn btn-sm"
              href={`/conversations/${id}/artifacts/${lead.artifact.id}`}
            >
              Edit, review or refine this version
            </Link>
            {lead.pending > 0 ? (
              <span role="status">
                {lead.pending} pending{" "}
                {lead.pending === 1 ? "proposal" : "proposals"} to review
              </span>
            ) : null}
          </div>
          {isProduct(lead.artifact.current_revision.body) ? (
            <ProductView body={lead.artifact.current_revision.body} />
          ) : isFlexible(lead.artifact.current_revision.body) ? (
            <ReadOnly body={lead.artifact.current_revision.body} />
          ) : null}
        </article>
      ) : null}
      {res.data
        ?.filter((item) => item !== lead && item.pending > 0)
        .map(({ artifact, pending }) => (
          <p className="small" key={artifact.id}>
            <Link href={`/conversations/${id}/artifacts/${artifact.id}`}>
              {artifact.current_revision.body.title}: {pending} pending to
              review
            </Link>
          </p>
        ))}
    </section>
  );
}

export function WorkAreaHeader({
  ws,
  id,
  area,
  inSpace = false,
  version,
  refresh,
}: {
  ws: string;
  id: string;
  area?: WorkArea | null;
  inSpace?: boolean;
  version: number;
  refresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [editVersion, setEditVersion] = useState(version);
  return (
    <section className="stack-sm" aria-label="Space context">
      {area ? (
        <>
          <p className="eyebrow-caps">
            {area.kind} Space ·{" "}
            {area.origin === "agent" ? "Agent identified" : "Human saved"}
          </p>
          <p className="lede">{area.goal}</p>
          {!inSpace ? (
            <Link href={areaHref(ws, id)}>Open persistent Space</Link>
          ) : null}
        </>
      ) : null}
      <button
        className="btn btn-sm"
        onClick={() => {
          if (!editing) setEditVersion(version);
          setEditing(!editing);
        }}
      >
        {area ? "Edit Space goal" : "Keep as a Space"}
      </button>
      {editing ? (
        <>
          <p className="hint">
            Saving a scope change cancels queued or in-flight turns. Saved
            artifacts and human edits are preserved.
          </p>
          <AreaForm
            initial={area ?? undefined}
            label="Save Space"
            submit={async (input) => {
              await workAreas.promote(
                ws,
                id,
                editVersion,
                input,
                crypto.randomUUID(),
              );
              setEditing(false);
              await refresh();
            }}
          />
        </>
      ) : null}
    </section>
  );
}
