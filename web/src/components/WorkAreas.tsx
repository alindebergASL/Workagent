"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { API_MODE, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { usePendingCommand } from "@/lib/client/pending-command";
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

function readKept(key: string): AreaInput | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AreaInput) : null;
  } catch {
    return null;
  }
}
function keep(key: string, value: AreaInput | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the typed values stay in memory */
  }
}

type Attempt = AreaInput & { command_id: string; expected?: number };

/**
 * A project's name, goal and kind. What's typed is kept across reloads until
 * it's saved. A save whose outcome is unknown is only ever replayed exactly
 * (same command, same version); a definite refusal frees the form.
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
}: {
  draftKey: string;
  initial?: AreaInput;
  /** The version the edit started from (compare-and-swap); none for a new project. */
  version?: number;
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
  const [value, setValue] = useState<AreaInput>(
    () =>
      readKept(draftKey) ?? {
        title: initial?.title ?? "",
        goal: initial?.goal ?? "",
        kind: initial?.kind ?? "project",
      },
  );
  useEffect(() => keep(draftKey, value), [draftKey, value]);
  const pending = usePendingCommand<Attempt>(`${draftKey}:pending`);
  useEffect(() => {
    if (pending.restored && pending.current) setValue(pending.current);
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
          expected: version,
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
  const [from, setFrom] = useState(version);
  // After a refused save, saving is held until the project has been re-read;
  // the next deliberate save is then checked against that version, the one
  // now on screen. A cancel and reopen meanwhile doesn't release the hold.
  const [conflicted, setConflicted] = useState(false);
  useEffect(() => {
    if (conflicted && version !== from) {
      setFrom(version);
      setConflicted(false);
    }
  }, [conflicted, version, from]);
  const conflict = () => {
    setConflicted(true);
    void refresh().then((fresh) => {
      if (!fresh) return; // Unread: stay held; a later read releases it.
      setFrom(fresh.conversation.work_version);
      setConflicted(false);
    });
  };
  // A draft or unconfirmed save survives a reload: reopen the editor for it.
  useEffect(() => {
    try {
      if (
        sessionStorage.getItem(draftKey) ||
        sessionStorage.getItem(`${draftKey}:pending`)
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
            version={from}
            label="Save"
            onCancel={() => setEditing(false)}
            onConflict={conflict}
            held={conflicted}
            submit={async (attempt) => {
              await workAreas.promote(
                ws,
                id,
                attempt.expected ?? from,
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
              if (!conflicted) setFrom(version);
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
    <section className="stack" aria-labelledby="projects-heading">
      <div className="row wrap">
        <h2 id="projects-heading">Projects and workflows</h2>
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
        <AreaForm
          draftKey={`workagent:space-new:${ws}`}
          label="Create project"
          onCancel={() => setCreating(false)}
          submit={async (attempt) => {
            const cv = await workAreas.create(
              ws,
              { title: attempt.title, goal: attempt.goal, kind: attempt.kind },
              attempt.command_id,
            );
            router.push(areaHref(ws, cv.id));
          }}
        />
      ) : null}
      {res.error ? <ErrorNotice error={res.error} /> : null}
      {res.loading && !res.data ? <p role="status">Loading projects…</p> : null}
      <ul className="work-list">
        {res.data?.map((cv) => (
          <li key={cv.id}>
            <Link className="work-row" href={areaHref(ws, cv.id)}>
              <strong>{cv.work_area?.title ?? cv.title}</strong>
              {cv.work_area?.goal ? (
                <span className="clamp-2">{cv.work_area.goal}</span>
              ) : null}
              <span className="small muted">
                {cv.work_area ? KIND[cv.work_area.kind] : "Project"}
                {cv.state === "cancelled" ? " · ended" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {res.data?.length === 0 ? (
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
  const [from, setFrom] = useState(version);
  // After a refused save, saving is held until the project has been re-read;
  // the next deliberate save is then checked against that version, the one
  // now on screen. A cancel and reopen meanwhile doesn't release the hold.
  const [conflicted, setConflicted] = useState(false);
  useEffect(() => {
    if (conflicted && version !== from) {
      setFrom(version);
      setConflicted(false);
    }
  }, [conflicted, version, from]);
  const conflict = () => {
    setConflicted(true);
    void refresh().then((fresh) => {
      if (!fresh) return; // Unread: stay held; a later read releases it.
      setFrom(fresh.conversation.work_version);
      setConflicted(false);
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
            version={from}
            label="Keep as a project"
            onCancel={() => setEditing(false)}
            onConflict={conflict}
            held={conflicted}
            submit={async (attempt) => {
              await workAreas.promote(
                ws,
                id,
                attempt.expected ?? from,
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
            if (!conflicted) setFrom(version);
            setEditing(true);
          }}
        >
          Keep as a project
        </button>
      )}
    </section>
  );
}
