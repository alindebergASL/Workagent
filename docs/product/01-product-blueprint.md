# Workagent product blueprint

**Version:** 1.1 · 12 November 2026 · canonical repository direction

**Status:** Revised product specification adopted by the bounded cleanup. Product implementation is not activated by this approval; no rebuild or deployment is claimed.

**Basis:** Owner feedback and the accepted November 12 research/audit corrections. Those dated materials are reference, not a separate instruction set.

**Read next:** [Architecture](02-architectural-plan.md) · [Build steps](03-build-steps.md)

**Working authority:** [Development direction](../DEVELOPMENT_AUTHORITY.md) · [Model spending](../GENERAL_MODEL_AUTHORIZATION.md) · [Actual status](../../STATUS.md)

## 1. Product promise

**Delegate once. Work together. Keep selected work alive.**

Workagent is a persistent general agent operating a shared, editable workspace. People describe outcomes in ordinary language, supply permitted context, work directly alongside the agent, redirect it, and return to useful progress. They do not operate a workflow engine or manage a collection of agent sessions.

Conversation is the control surface. Artifacts are the work. Responsibilities provide continuity. Sources and permissions connect them.

The product must be useful for unfamiliar tasks—not just a demonstration dataset, a financial workflow, or a fixed menu of examples. A concise answer is sometimes the right outcome. A workbook, board, analysis, application, or continuing responsibility is appropriate only when it helps.

## 2. Why this replaces the previous product

The old build and the DSH workshop demonstrated internal execution but did not deliver a compelling general agent. The owner found them basic, confusing, clunky, and too focused on explaining machinery.

Retain the useful engineering: public DSH integration, concurrency, steering, recovery, provider fidelity work, retained human contributions, accounting, and ambiguous-effect handling. Retire the fixed workshop as the product model, budget-only steering, global edit conflicts, suppressed agent updates, and setup-first navigation.

The client is rebuilt from the ground up. No imports from the rejected component trees. Old saved work remains preserved; preservation does not mean retaining the old UX.

## 3. Experience principles

1. **Start with an intention.** No project-creation wizard or workflow configuration is required to begin.
2. **Make progress, not narration.** Show actual work and meaningful consequences. Tool logs and internal identifiers belong in details.
3. **Keep conversation available.** The composer remains usable while work runs and while an artifact is open.
4. **Support direct manipulation.** People edit cells, text, slides, objects, filters, and app controls themselves.
5. **Respect human contributions.** New agent findings stay visible without silently overwriting a deliberate edit.
6. **Keep related work connected.** A changed assumption updates intended dependencies, not arbitrary copies.
7. **Be quiet when nothing matters.** Background checks do not generate a stream of empty updates.
8. **Use permissions proportionately.** Routine preparation proceeds; consequential commitments require the actual authority appropriate to the action.
9. **Make return effortless.** Lead with changed outcomes, open decisions, and continuing commitments.
10. **Keep uncertainty specific.** “The supplier has not confirmed capacity” is useful; repeated generic disclaimers are not.

## 4. Product surfaces

### Home and conversation

A stable conversation input accepts text, attachments, public links, selections, and eventually voice. Home prioritizes decisions and meaningful changes, followed by recent work and pinned apps. One coherent relationship can contain multiple independent tasks without leaking their context into each other.

Progress language describes outcomes: “The quotes use different capacity assumptions.” It does not narrate every tool call. Pause, redirect, and stop are immediately available.

### Work area

The current document, sheet, board, deck, analysis, or application sits beside conversation. A full-screen editor retains a compact route back to the agent. Selection supplies precise context for questions and edits.

Native artifacts, generated applications, and hosted partner applications are distinct implementations within a consistent shell. The interface must not imply that Workagent owns a partner's storage or can undo every action on a partner website.

### Return and responsibilities

A responsibility states what to keep current, which sources/actions are allowed, what warrants interruption, and when to stop. The user can inspect, revise, pause, or end it conversationally or directly. Returning home surfaces changes and decisions, not a transcript of overnight polling.

### Phone

Phone access is a continuation of the same work: read, dictate, comment, edit a cell, make a focused board change, approve an exact action, or pause a responsibility. Dense canvases need list/inspector alternatives. Viewport fit alone is not phone acceptance.

## 5. Committed capability scope

These scope IDs are stable references used by the architecture and build documents. They describe required behavior, not completed features.

### P01 — General delegation and persistent execution

Accept unfamiliar objectives and permitted files/links; use real models and tools; create useful outcomes; revise intent during execution; run unrelated work concurrently; cancel honestly; resume after interruption. Native children may help without becoming a team-management interface. The scripted compatibility provider is not product acceptance.

### P02 — Genuine sheets

Direct human and agent cell editing; multiple tabs; cross-tab formulas; formatting and conditional formatting; dropdowns, checkboxes, charts; range-aware questions; visible changes; comments and history. Support blank creation, paste, CSV/XLSX import, authorized Google Sheets import, CSV/XLSX export, and useful phone cell editing.

The November 12, 2026 competitor reference reports 100,000 cells and 144 functions. Qualify representative populated sheets and formula workloads, and document supported and unsupported formula families. The exact competitor function catalogue was not enumerated in the supplied reference; its completeness remains unknown. A higher function count does not establish parity.

### P03 — Genuine whiteboards

Create from conversation, dictation, or sketch; directly manipulate shapes, connectors, groups/sections, themes, text, owners, dates, and flows. Include region-aware help, teammate following, images and playable video, collaborative editing, annotations, PNG export, and conversion into editable documents/decks with explicit lineage.

Dictation language coverage is a real qualification item, not an English-only checkbox. The November 12, 2026 reference establishes multilingual scope but supplies no verified complete launch-language catalogue here; exact catalogue completeness remains unknown. Record and test supported versus unqualified languages when implementing dictation, without turning a changing competitor page into a moving completion gate. A speech-input component alone does not establish multilingual support.

### P04 — Documents and presentations

Rich direct editing, selection-aware assistance, collaborative changes, comments/history, presentation mode, and source-linked values. Deliver Word/PDF/Markdown and PowerPoint/PDF exports, with supported editable Google Docs and Google Slides destinations. Imported and exported content must be reopened and checked; unsupported formatting is disclosed.

### P05 — Collaboration, contributions, and history

Two humans and the agent can work together with identifiable presence/cursors/selections. Reconnect converges. Comments retain their anchors. Individual undo differs from whole-artifact restore. A restore produces a new revision. A stale agent proposal cannot erase a human change or disappear behind it.

### P06 — Connected artifacts

Connect a board, sheet, dataset, chart, document, deck, and video through explicit references. Distinguish live values, maintained interpretations, and snapshots. Preserve manual overrides until deliberately relinked. Show stale dependencies and partial updates. Publish a consistent set of revisions when outputs must agree.

### P07 — Connected data and analysis

Query owned files and authorized remote sources; inspect query, parameters, provenance, transformations, and freshness; directly refine dashboard titles, captions, charts, filters, and drill-downs. Produce dashboards, data stories/scrollytelling, and written interpretations.

Committed source adapters: **Redshift, BigQuery, ClickHouse, Databricks, Snowflake, and Salesforce**. One functioning connector proves an integration pattern, not completion of this list.

### P08 — Metrics, sharing, and design systems

Reuse human-approved query/metric definitions; invalidate approval when definitions change; integrate supported dbt, Looker, Cube, and Git-backed definitions. Only an authorized human can apply a certified designation; ordinary uncertified queries, charts and analysis remain usable with truthful status. Share private/team/external views and bounded live results without handing out the creator's source credentials.

Apply workspace fonts, colors, chart conventions, and layouts across artifacts, stories, and videos while retaining deliberate local overrides. Revocation blocks future access and refresh; downloaded copies cannot be recalled.

### P09 — Interactive partner applications

Discover, open, pin, and use supported applications inline, beside conversation, and full screen. Support direct interaction and view-provided tools. Embedded full editors require partner-supported framing and authentication. App state supplied to the agent is context, not a new instruction or permission grant.

### P10 — Generated connected applications

Create useful custom calculators, explorers, trackers, and interfaces in a restricted host. Separate personal and shared storage. Allow only scoped data/actions. Sharing the app must not share its creator's connections or model budget. Native sheets and boards cannot be replaced by generated HTML to claim parity.

### P11 — Ongoing responsibilities and meaningful notifications

Maintain authorized work with all clients closed. Support schedules and relevant external events, deduplicated observations, quiet hours, digest preferences, end conditions, and pause/resume. Update deterministic values and propose semantic changes. Do not notify on unchanged observations.

### P12 — Scoped memory and learned methods

Remember explicit preferences and source-backed reusable facts with inspectable scope. Support correction and forgetting; stop retrieving revoked material. Separate explicit instructions from inferred preferences. Promote useful methods from successful work without installing untrusted instructions as policy. Compaction is not memory.

### P13 — Files, browser, computer, and takeover

Use isolated files, computation, retrieval, browser tools, and curated MCP capabilities. Preserve authorized context across sessions. Let the user securely take over the agent browser; pause observation and actions during sensitive login. Local folder/device access requires an explicit grant and a future bridge—not a mount of the operator's home.

### P14 — Narrated briefs and video

Generate short videos from revision-bound scenes, charts, narration, and captions. Edit a claim or chart and regenerate the affected scene. Export a playable file. Narration quality, languages, voice assets, codecs, and resource costs require qualification.

### P15 — Partner delivery

Support destination-specific “Send to” mappings and preserve external receipts/links. Coverage includes spreadsheet destinations **Airtable, Asana, monday.com, Smartsheet**; board destinations **Lucid, Miro, Zoho Vani**; and data partners **Amplitude, Mixpanel, Omni, PostHog, Sigma**. Google Sheets, Google Docs and Google Slides destinations are part of P02/P04.

A generic export is not proof of every named destination. Usable APIs, accounts, partner support, and authority must exist. If unavailable, the affected integration remains explicitly incomplete; do not claim full parity or silently substitute an unrelated destination. Adobe, Atlassian, Box, Notion, and other full editors similarly depend on supported embedding rather than cloning their applications.

### P16 — Continuity, portability, and bounded judgment

Continue work across desktop and phone, later messaging and explicitly granted devices. Export work and retain its meaning across approved model-route changes. Integrate genuine JeV-style choice/ranking for a useful bounded decision, with deterministic fallback. It never grants permission, certifies a metric, or suppresses a mandatory approval.

## 6. The defining journeys

These are design acceptance journeys, not reports of execution.

### Journey A — Plan together, then keep it current

Provide an unfamiliar project brief, quotes, attendance data, and links. Ask for a practical programme and budget. Receive an editable board and sheet only where useful. A teammate changes capacity; the linked budget updates. A human overrides a cost; refresh preserves it. Select the increase and ask for a cheaper alternative without compromising accessibility.

Create an analysis, document, deck, and narrated brief from approved values. Authorize specific ongoing checks. Close every client. A meaningful source change updates intended values, proposes affected wording, and raises the appropriate decision.

### Journey B — Redirect without losing momentum

During that work, change the programme to weekends and start an unrelated travel comparison. The composer remains usable. The first work item receives a new intent revision; the second receives separate context and authority. Old results remain identifiable. Login or booking is not silently authorized by the research task.

### Journey C — Return to useful progress

Return on a phone. See what changed, what remains uncertain, and the decision needed. Inspect the actual artifact or patch, make a focused edit, approve only an exact authorized action, or pause the responsibility. Detailed activity is available but not required to understand the situation.

## 7. Delivery outcomes

1. **One real editable result.** Unfamiliar synthetic input through the approved, accounting-backed DSH/model path produces a genuine sheet **or** document. A person corrects it, sees protected proposals and gets useful continuation after save/reopen. Implement only the identity/source scope, native editor, persistence and enabled-tool isolation this path needs (P01, initial P02/P04/P05, relevant P13/P16).
2. **Continuity under change.** Steer and cancel, restart, preserve an intervening edit and run independently scoped work. Add secure remote access and focused phone use; obtain physical-phone evidence for those claims when available (P01/P05/P13/P16).
3. **A responsibility with all clients closed.** Keep one file-backed or authorized-source result current with durable occurrences, changed/no-change handling, preserved overrides and a useful return state. This comes before broad office or data-suite completion (initial P06/P11).
4. **Shared native work.** Complete sheets, boards, documents/decks, multi-human presence, comments/history, selection help, file round-trips, explicit bindings and design systems (P02–P06, relevant P08/P16).
5. **Complete connected scope.** Add all named data/semantic/destination adapters, dashboards/stories, sharing, memory/methods, genuine bounded JeV, partner/generated apps, voice, narrated video and broader channels/devices (P07–P16 and remaining native scope). Per-owner VM isolation and suitable licensing precede hosting unrelated users.

These outcomes sequence all P01–P16 requirements. Later units depend on actual technical foundations, not acceptance of an entire milestone. Owner feedback determines usefulness acceptance; unavailable feedback or a physical phone does not stop independent authorized work. Basic mobile use and whiteboard dictation are not deferred wholesale to the final outcome. Missing partner/JeV access blocks those integrations and prevents a full-parity claim, not core delivery.

## 8. What “better” must mean

Demonstrate connected work surviving change, preservation of human intent, genuine unattended maintenance, coherent permissions, useful return, and portable context. These are more defensible than “more agents” or “more tools.”

The November 12, 2026 research recorded these dated Claude boundaries: Sheets lacks live connected-app data and downstream source use; Whiteboards lacks connected-app context; Data refreshes when opened and due; Duet is already proactive but does not modify existing Claude artifacts. These are dated opportunities, not permanent moats, current live-product verification or measured Workagent advantages.

Competitive superiority requires comparable real outcomes and access to the actual products. No authenticated comparative benchmark was performed. Owner usefulness is the immediate acceptance standard; no study or paid benchmark campaign is implied.

## 9. Explicit non-goals and boundaries

Do not build another fixed showcase, workflow editor, generic agent platform, second model/tool loop, universal graph database, homegrown spreadsheet engine, or cloned partner application. Do not add a process framework around every small change.

Keep the existing spending authority and historical receipts. The cumulative product ceiling is $275, not new funding; reread live accounting before paid work. New paid routes, SDK purchases, private access, external effects, installed-data maintenance, destructive cleanup, default-branch merge, and public deployment retain their actual approval requirements. Ordinary reversible work should not acquire invented per-step approval gates.

This cleanup does not activate implementation, purchase a license, restart the stopped legacy installation or authorize broader data use. Product-model data remains synthetic-only until scope and handling are reconciled. Later authorized increments continue without per-packet consent, while real effects retain their genuine authority requirements.

## 10. Source anchors and unresolved dependencies

- [Claude announcement](https://claude.com/resources/articles/sheets-whiteboards-data)
- [Sheets](https://support.claude.com/en/articles/18324300-get-started-with-claude-sheets) · [Whiteboards](https://support.claude.com/en/articles/18324319-get-started-with-claude-whiteboards) · [Data](https://support.claude.com/en/articles/17454700-get-started-with-claude-data)
- [Interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude) · [Duet](https://support.claude.com/en/articles/17631495-get-started-with-claude-duet)
- [Univer pricing](https://univer.ai/pricing/) · [License](https://univer.ai/legal/license-agreement/)

These links anchor the November 12, 2026 reference; no fresh competitor or license verification is claimed by this cleanup. Univer fit/licensing, file fidelity, resources, partner access, formula/language coverage, the ledger bridge and DSH/provider compatibility remain qualification dependencies. A coherent rc1 product path is allowed if rc2 qualification blocks. Dependencies constrain affected capabilities; they do not stop independent core work. The architecture specifies their technical boundaries and the build document schedules their implementation.
