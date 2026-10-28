"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { API_MODE, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { usePendingCommand } from "@/lib/client/pending-command";
import { scopedSession } from "@/lib/client/session-scope";
import {
  areaHref,
  workAreas,
  type AreaInput,
  type WorkArea,
} from "@/lib/client/work-areas";
import { ApiError } from "@/lib/contract/errors";
import { ErrorNotice } from "./ui";

const KIND: Record<AreaInput["kind"], string> = {
  project: "Project",
  workflow: "Ongoing workflow",
};

/** What's typed, and the project version the edit started from. */
type Draft = AreaInput & { base?: number };

function readKept(key: string): Draft | null {
  try {
    const raw = scopedSession.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function keep(key: string, value: Draft | null) {
  try {
    if (value) scopedSession.setItem(key, JSON.stringify(value));
    else scopedSession.removeItem(key);
  } catch {
    /* storage unavailable: the typed values stay in memory */
  }
}

type Attempt = AreaInput & { command_id: string; expected?: number };

/**
 * A project's name, goal and kind. What's typed is kept across reloads until
 * it's saved, together with the version the edit started from: a save is
 * checked against that version even after a reload, so a change made
 * meanwhile is never overwritten unseen. The base moves only when a refused
 * save has been re-read (`rebase`). A save whose outcome is unknown is only
 * ever replayed exactly (same command, same version); a definite refusal
 * frees the form.
 */
function AreaForm({
  draftKey,
  initial,
  version,
  submit,
  label,
  onCancel,
  onConflict,
  held = false,
  rebase = null,
}: {
  draftKey: string;
  initial?: AreaInput;
  /** The project's version when a new draft starts; none for a new project. */
  version?: number;
  /** After a refused save is re-read: the version to check the next save against. */
  rebase?: { to: number; id: number } | null;
  submit: (attempt: Attempt) => Promise<void>;
  label: string;
  onCancel?: () => void;
  /** A save was refused because the project changed: re-read it. */
  onConflict?: () => void;
  /**
   * The project is being re-read after a refused save. Saving waits for it,
   * so the next save is checked against the version the person can now see.
   */
  held?: boolean;
}) {
  const [value, setValue] = useState<Draft>(() => {
    const kept = readKept(draftKey);
    if (kept) return { ...kept, base: kept.base ?? version };
    return {
      title: initial?.title ?? "",
      goal: initial?.goal ?? "",
      kind: initial?.kind ?? "project",
      base: version,
    };
  });
  useEffect(() => keep(draftKey, value), [draftKey, value]);
  // Only a rebase issued after this form opened applies to it.
  const seen = useRef(rebase?.id);
  useEffect(() => {
    if (!rebase || rebase.id === seen.current) return;
    seen.current = rebase.id;
    setValue((v) => ({ ...v, base: rebase.to }));
  }, [rebase]);
  const pending = usePendingCommand<Attempt>(`${draftKey}:pending`);
  useEffect(() => {
    if (pending.restored && pending.current)
      setValue({ ...pending.current, base: pending.current.expected });
  }, [pending.restored, pending.current]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const uid = useId();
  const uncertain = Boolean(pending.current) && !busy;
  const set = (patch: Partial<AreaInput>) =>
    setValue((v) => ({ ...v, ...patch }));
  return (
    <form
      className="stack-sm area-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || held) return;
        const attempt: Attempt = pending.current ?? {
          command_id: newCommandId(),
          expected: value.base,
          title: value.title.trim(),
          goal: value.goal.trim(),
          kind: value.kind,
        };
        if (!attempt.title || !attempt.goal) return;
        setBusy(true);
        setError(null);
        try {
          if (!pending.current) pending.set(attempt);
          await submit(attempt);
          if (pending.clear(attempt)) {
            keep(draftKey, null);
          }
        } catch (err) {
          if (!(err instanceof ApiError && err.isAmbiguousWrite))
            pending.clear(attempt);
          if (err instanceof ApiError && err.isVersionConflict) onConflict?.();
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor={`${uid}-name`}>Name</label>
        <input
          id={`${uid}-name`}
          required
          maxLength={240}
          value={value.title}
          disabled={uncertain || busy}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-goal`}>What it’s for</label>
        <textarea
          id={`${uid}-goal`}
          required
          maxLength={2000}
          rows={3}
          value={value.goal}
          disabled={uncertain || busy}
          onChange={(e) => set({ goal: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-kind`}>Kind</label>
        <select
          id={`${uid}-kind`}
          value={value.kind}
          disabled={uncertain || busy}
          onChange={(e) => set({ kind: e.target.value as AreaInput["kind"] })}
        >
          <option value="project">{KIND.project}</option>
          <option value="workflow">{KIND.workflow}</option>
        </select>
      </div>
      {error instanceof ApiError && error.isVersionConflict ? (
        <p role="status" className="hint">
          This project changed since you started editing. What you typed is
          kept; check the project and save again.
        </p>
      ) : error ? (
        <ErrorNotice error={error} />
      ) : null}
      {held && !uncertain ? (
        <p role="status" className="hint" data-testid="area-rechecking">
          Checking what changed before you can save again…
        </p>
      ) : null}
      {uncertain ? (
        <p role="status" className="hint">
          Your last save wasn’t confirmed. Saving again sends exactly the same
          change, so it can’t be applied twice.
        </p>
      ) : null}
      <div className="row">
        <button
          className="btn btn-sm"
          disabled={
            busy ||
            (!uncertain && (held || !value.title.trim() || !value.goal.trim()))
          }
        >
          {busy ? "Saving…" : uncertain ? "Retry the same save" : label}
        </button>
        {onCancel && !uncertain ? (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => {
              keep(draftKey, null);
              onCancel();
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** A project's name, purpose and kind, editable by the person. */
export function SpaceDetails({
  ws,
  id,
  area,
  title,
  version,
  open,
  refresh,
}: {
  ws: string;
  id: string;
  area: WorkArea | null;
  title: string;
  version: number;
  open: boolean;
  refresh: () => Promise<{ conversation: { work_version: number } } | null>;
}) {
  const draftKey = `workagent:space-edit:${ws}:${id}`;
  const [editing, setEditing] = useState(false);
  // After a refused save, saving is held until the project has been re-read;
  // the draft's base then moves to that version, the one now on screen. A
  // cancel and reopen meanwhile doesn't release the hold.
  const [conflicted, setConflicted] = useState(false);
  const [rebase, setRebase] = useState<{ to: number; id: number } | null>(null);
  const settle = (to: number) => {
    setRebase((r) => ({ to, id: (r?.id ?? 0) + 1 }));
    setConflicted(false);
  };
  const lastVersion = useRef(version);
  useEffect(() => {
    // A later read that lands first releases the hold just the same.
    if (conflicted && version !== lastVersion.current) settle(version);
    lastVersion.current = version;
  }, [conflicted, version]);
  const conflict = () => {
    setConflicted(true);
    void refresh().then((fresh) => {
      if (fresh) settle(fresh.conversation.work_version);
      // Unread: stay held; a later read releases it.
    });
  };
  // A draft or unconfirmed save survives a reload: reopen the editor for it.
  useEffect(() => {
    try {
      if (
        scopedSession.getItem(draftKey) ||
        scopedSession.getItem(`${draftKey}:pending`)
      )
        setEditing(true);
    } catch {
      /* nothing kept */
    }
  }, [draftKey]);
  return (
    <header className="stack-sm space-header">
      <p className="eyebrow-caps">
        {area ? KIND[area.kind] : "Project"}
        {open ? "" : " · ended"}
      </p>
      <h1 className="h1-long">{area?.title ?? title}</h1>
      {area ? <p className="lede space-goal">{area.goal}</p> : null}
      {area?.origin === "agent" && !editing ? (
        <p className="small muted">
          Workagent named this from your request. Change it if it isn’t right.
        </p>
      ) : null}
      {editing ? (
        <>
          <p className="hint">
            Saving stops any reply still in progress here, so the next one works
            from what you set. Saved work and your edits stay as they are.
          </p>
          <AreaForm
            draftKey={draftKey}
            initial={area ?? undefined}
            version={version}
            label="Save"
            onCancel={() => setEditing(false)}
            onConflict={conflict}
            held={conflicted}
            rebase={rebase}
            submit={async (attempt) => {
              await workAreas.promote(
                ws,
                id,
                attempt.expected ?? version,
                {
                  title: attempt.title,
                  goal: attempt.goal,
                  kind: attempt.kind,
                },
                attempt.command_id,
              );
              setEditing(false);
              await refresh();
            }}
          />
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit name and purpose
          </button>
        </div>
      )}
    </header>
  );
}

type SpaceRef = { id: string; name: string };
type AreaRow = Awaited<ReturnType<typeof workAreas.list>>[number] & {
  ws: SpaceRef;
};

/**
 * The person's projects in one list, however many workspaces hold them: a
 * row names its workspace only when there is more than one. A workspace
 * that can't be read is said once; the others still show.
 */
export function WorkAreaList({ spaces }: { spaces: SpaceRef[] }) {
  return API_MODE === "real" && spaces.length ? (
    <RealWorkAreaList spaces={spaces} />
  ) : null;
}

function RealWorkAreaList({ spaces }: { spaces: SpaceRef[] }) {
  const router = useRouter();
  const key = spaces.map((w) => w.id).join(",");
  const res = useResource(`work-areas:${key}`, async (signal) => {
    const read = await Promise.allSettled(
      spaces.map((w) => workAreas.list(w.id, signal)),
    );
    if (read.every((r) => r.status === "rejected"))
      throw (read[0] as PromiseRejectedResult).reason;
    const rows: AreaRow[] = [];
    let unreadable = 0;
    read.forEach((r, i) => {
      if (r.status === "fulfilled")
        rows.push(...r.value.map((cv) => ({ ...cv, ws: spaces[i]! })));
      else unreadable++;
    });
    return { rows, unreadable };
  });
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState(spaces[0]!.id);
  const many = spaces.length > 1;
  const into = spaces.find((w) => w.id === target) ?? spaces[0]!;
  return (
    <section className="stack" aria-labelledby="projects-heading">
      <div className="row wrap">
        <h2 id="projects-heading">Projects</h2>
        <button
          type="button"
          className="btn btn-sm"
          aria-expanded={creating}
          onClick={() => setCreating(!creating)}
        >
          New project
        </button>
      </div>
      {creating ? (
        <>
          {many ? (
            <label className="field">
              <span className="field-label">Workspace</span>
              <select
                value={into.id}
                onChange={(e) => setTarget(e.target.value)}
              >
                {spaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <AreaForm
            key={into.id}
            draftKey={`workagent:space-new:${into.id}`}
            label="Create project"
            onCancel={() => setCreating(false)}
            submit={async (attempt) => {
              const cv = await workAreas.create(
                into.id,
                {
                  title: attempt.title,
                  goal: attempt.goal,
                  kind: attempt.kind,
                },
                attempt.command_id,
              );
              router.push(areaHref(into.id, cv.id));
            }}
          />
        </>
      ) : null}
      {res.error ? <ErrorNotice error={res.error} /> : null}
      {res.loading && !res.data ? <p role="status">Loading projects…</p> : null}
      {res.data?.unreadable ? (
        <p className="small muted" role="status">
          Projects in{" "}
          {res.data.unreadable === 1
            ? "one workspace"
            : `${res.data.unreadable} workspaces`}{" "}
          couldn’t be read, so they aren’t listed.
        </p>
      ) : null}
      {res.data?.rows.length ? (
        <ul className="work-list">
          {res.data.rows.map((cv) => (
            <li key={`${cv.ws.id}/${cv.id}`}>
              <Link className="work-row" href={areaHref(cv.ws.id, cv.id)}>
                <span className="work-row-main">
                  <strong className="work-row-title">
                    {cv.work_area?.title ?? cv.title}
                  </strong>
                  {cv.work_area?.goal ? (
                    <span className="clamp-2 muted">{cv.work_area.goal}</span>
                  ) : null}
                </span>
                <span className="small muted project-meta">
                  {cv.work_area ? KIND[cv.work_area.kind] : "Project"}
                  {many ? ` · ${cv.ws.name}` : ""}
                  {cv.state === "cancelled" ? " · ended" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : res.data ? (
        <p className="muted">
          No projects yet. A project keeps related work and its conversation
          together. Quick questions don’t need one.
        </p>
      ) : null}
    </section>
  );
}

/**
 * On a conversation: the project it belongs to, or a way to keep it as one.
 */
export function WorkAreaHeader({
  ws,
  id,
  area,
  version,
  refresh,
}: {
  ws: string;
  id: string;
  area?: WorkArea | null;
  version: number;
  refresh: () => Promise<{ conversation: { work_version: number } } | null>;
}) {
  const draftKey = `workagent:space-edit:${ws}:${id}`;
  const [editing, setEditing] = useState(false);
  // After a refused save, saving is held until the project has been re-read;
  // the draft's base then moves to that version, the one now on screen. A
  // cancel and reopen meanwhile doesn't release the hold.
  const [conflicted, setConflicted] = useState(false);
  const [rebase, setRebase] = useState<{ to: number; id: number } | null>(null);
  const settle = (to: number) => {
    setRebase((r) => ({ to, id: (r?.id ?? 0) + 1 }));
    setConflicted(false);
  };
  const lastVersion = useRef(version);
  useEffect(() => {
    // A later read that lands first releases the hold just the same.
    if (conflicted && version !== lastVersion.current) settle(version);
    lastVersion.current = version;
  }, [conflicted, version]);
  const conflict = () => {
    setConflicted(true);
    void refresh().then((fresh) => {
      if (fresh) settle(fresh.conversation.work_version);
      // Unread: stay held; a later read releases it.
    });
  };
  if (area)
    return (
      <p className="small space-link">
        Part of <strong>{area.title}</strong> ·{" "}
        <Link href={areaHref(ws, id)}>Open the project</Link>
      </p>
    );
  return (
    <section className="stack-sm" aria-label="Keep as a project">
      {editing ? (
        <>
          <p className="hint">
            Name it and say what it’s for. Saving stops any reply still in
            progress here; saved work stays as it is.
          </p>
          <AreaForm
            draftKey={draftKey}
            version={version}
            label="Keep as a project"
            onCancel={() => setEditing(false)}
            onConflict={conflict}
            held={conflicted}
            rebase={rebase}
            submit={async (attempt) => {
              await workAreas.promote(
                ws,
                id,
                attempt.expected ?? version,
                {
                  title: attempt.title,
                  goal: attempt.goal,
                  kind: attempt.kind,
                },
                attempt.command_id,
              );
              setEditing(false);
              await refresh();
            }}
          />
        </>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          onClick={() => {
            setEditing(true);
          }}
        >
          Keep as a project
        </button>
      )}
    </section>
  );
}
