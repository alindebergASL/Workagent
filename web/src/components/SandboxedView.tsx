"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildViewDocument,
  readViewMessage,
  VIEW_ALLOW,
  VIEW_CSP,
  VIEW_LIMITS,
  VIEW_SANDBOX,
  viewProblem,
  type ViewSource,
} from "@/lib/sandbox";

/**
 * What a view may ask the host to do. Each handler gets the view's payload
 * as untrusted input and must validate it, recheck permission and freshness,
 * and go through the normal backend path. Anything not listed is refused.
 */
export type ViewActions = Record<
  string,
  (payload: unknown) => Promise<unknown>
>;

/**
 * An agent-created view, isolated from the app. The frame has an opaque
 * origin and a no-network content policy; the host hands it data and one
 * private port, sizes it, and answers only the actions it was given. If the
 * frame ever loads anything else, it is removed.
 */
export function SandboxedView({
  title,
  source,
  data,
  actions = {},
  fallback,
}: {
  /** What this view shows, for assistive technology. */
  title: string;
  source: ViewSource;
  data: unknown;
  actions?: ViewActions;
  /** Readable content when the view can't be shown. */
  fallback?: React.ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const loads = useRef(0);
  const sent = useRef<string>("");
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const [height, setHeight] = useState<number>(VIEW_LIMITS.minHeight);
  const [stopped, setStopped] = useState<string | null>(null);
  const problem = viewProblem(source, data);
  const doc = useMemo(() => buildViewDocument(source), [source]);
  // Data is cloned through JSON so nothing but plain values crosses.
  const json = useMemo(() => {
    try {
      return JSON.stringify(data ?? null);
    } catch {
      return "null";
    }
  }, [data]);

  // A new document is a new view: reset everything bound to the old one.
  useEffect(() => {
    loads.current = 0;
    setStopped(null);
    setHeight(VIEW_LIMITS.minHeight);
    return () => {
      port.current?.close();
      port.current = null;
    };
  }, [doc]);

  // Data that changes after the view connected is sent over its port.
  useEffect(() => {
    if (!port.current || sent.current === json) return;
    sent.current = json;
    port.current.postMessage({ type: "data", data: JSON.parse(json) });
  }, [json]);

  const connect = () => {
    const win = frame.current?.contentWindow;
    loads.current += 1;
    if (loads.current > 1) {
      // The view navigated or reloaded itself: it is no longer the document
      // the host built, so it gets nothing further.
      port.current?.close();
      port.current = null;
      setStopped("This view tried to load something else, so it was stopped.");
      return;
    }
    if (!win) return;
    const channel = new MessageChannel();
    port.current = channel.port1;
    const times: number[] = [];
    let pending = 0;
    channel.port1.onmessage = (event) => {
      const m = readViewMessage(event.data);
      if (!m) return;
      if (m.type === "resize") {
        setHeight(m.height);
        return;
      }
      const reply = (ok: boolean, value: unknown) =>
        channel.port1.postMessage(
          ok
            ? { type: "result", id: m.id, ok: true, value }
            : { type: "result", id: m.id, ok: false, error: String(value) },
        );
      if (m.refused) {
        reply(false, m.refused);
        return;
      }
      const now = Date.now();
      while (times.length && now - times[0]! > 60_000) times.shift();
      if (
        times.length >= VIEW_LIMITS.requestsPerMinute ||
        pending >= VIEW_LIMITS.pendingRequests
      ) {
        reply(false, "Too many requests.");
        return;
      }
      times.push(now);
      const handler = Object.hasOwn(actionsRef.current, m.action)
        ? actionsRef.current[m.action]
        : undefined;
      if (!handler) {
        reply(false, "This view can’t do that.");
        return;
      }
      pending += 1;
      handler(m.payload)
        .then(
          (value) => {
            let out: unknown = null;
            try {
              out = JSON.parse(JSON.stringify(value ?? null));
            } catch {
              out = null;
            }
            reply(true, out);
          },
          () => reply(false, "That didn’t work."),
        )
        .finally(() => {
          pending -= 1;
        });
    };
    sent.current = json;
    // An opaque-origin frame can only be addressed with "*"; the port it
    // receives is the only channel, and it reaches nothing but this host.
    win.postMessage({ type: "workagent:init", data: JSON.parse(json) }, "*", [
      channel.port2,
    ]);
  };

  if (problem || stopped)
    return (
      <figure className="sandboxed-view" data-state="stopped">
        <p role="status" className="small">
          {stopped ?? problem}
        </p>
        {fallback ?? null}
      </figure>
    );
  return (
    <figure className="sandboxed-view">
      <iframe
        key={doc}
        ref={frame}
        title={title}
        srcDoc={doc}
        sandbox={VIEW_SANDBOX}
        allow={VIEW_ALLOW}
        referrerPolicy="no-referrer"
        loading="eager"
        style={{ height }}
        onLoad={connect}
        {...{ csp: VIEW_CSP }}
      />
      <figcaption className="small muted">
        Made by Workagent for this work. It can’t reach your account or the
        internet.
      </figcaption>
    </figure>
  );
}
