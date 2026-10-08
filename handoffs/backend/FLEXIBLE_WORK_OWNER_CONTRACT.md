# Hermes / Claude owner contract — next #13 slice

Status: **approved direction and owner contract; generated wire contract and
implementation still pending. Issue #13 remains OPEN.** Closing the finite
adaptive checkpoint does not deliver flexible creation or sandboxed HTML.

## Agreement grounded in owner communication

Claude's [self-describing-work proposal](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6064229508)
and [generic-table delivery](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6064378005)
are acknowledged. Hermes accepts the structured-work direction and existing
owner split in [the closeout coordination ACK](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6066967288).
Andrew's [#13 direction](https://github.com/alindebergASL/Workagent/issues/13)
adds sandboxed HTML/CSS/scoped JavaScript and supersedes the proposal's original
blanket no-HTML/no-script ceiling.

Do not claim both owners have already ACKed a generated custom-view schema:
there is no such delivered DTO yet. That concrete compatibility ACK belongs with
the next generated contract, not another user permission checkpoint.

## Accepted division of work

- **Hermes:** durable data/source/assets, versioned contracts and migrations,
  admission/operations, execution and verification evidence, scoped broker actions,
  stale-version/access checks, cumulative budget and non-default integration.
- **Existing Claude owner:** rendering, editing, interaction, accessibility,
  responsive work/conversation continuity and the isolated custom-artifact surface.
- Preserve both owners' changes. Claude `ea4e29d` is integrated at `65e84c6` alongside
  Hermes's bounded verification and proposed-file download. No competing frontend
  writer or redesign. Local CLI authentication status does not prove remote-owner
  availability; Claude's published resumed work supersedes the stale blocked note.

## Minimum common contract for implementation

1. Work stays on the current artifact/revision/proposal/history model. Stable
   field identities, typed values, source and exact revision references are durable;
   the rendered DOM is never canonical work.
2. Adopt Claude's column-description basis: `key`, `label`, `type`
   (text/integer/decimal/money/date/boolean/enum), optional unit/scale/enum values,
   editable/derived metadata. Operation-owned summaries/issues remain evidence-bound.
   Tool output descriptions use label/unit/scale. Existing documents/checklists
   become reachable from the general path; invoice reconciliation remains a specialized
   capability rather than every table's admission schema.
3. Add one explicitly versioned custom-view capability: durable HTML/CSS/JavaScript
   source and bounded assets, exact data bindings and declared supported interactions.
   Historical artifacts retain their meanings; no silent reinterpretation/migration.
4. Generated content gets an isolated browsing context and no application credentials,
   ambient workspace authority or direct backend client. Explicitly define/test
   resource/network policy, navigation, downloads and browser capabilities; a sandbox
   attribute alone is not the safety proof. Do not inject code into the trusted shell.
5. A narrow validated host/broker interface binds requests to the view instance,
   artifact/revision and user scope. Host permission and freshness are rechecked.
   No arbitrary record writes, automatic proposal approval or unrestricted execution.
   Allowed interactivity must work, not only fail closed.
6. Approval and permission controls stay in the trusted shell. Model/view-provided
   “verified” labels, formulas and summaries are not verification. Unsupported work
   remains useful but unverified; independent evidence retains exact checked scope.
7. Publish generated field names, limits and message/action schemas together. Claude
   ACKs and implements against those bytes; neither owner invents speculative endpoints.

## Next smallest implementation slice

Hermes publishes additive general-table/document admission plus custom-view
storage/data/action DTOs, compatibility migration and broker tests. Claude then
consumes that contract to deliver a general structured renderer and an isolated
agent-created custom HTML view. Integrate two meaningfully different synthetic
requests without task-name branches or bespoke pages—for example a volunteer
rota and a comparison/decision view—using only the first genuinely needed actions.
These examples are test choices, not a new fixed task catalog.

Acceptance: actual model-created work plus save/revise/reopen/restart, preserved
human edits, stale-view refusal, scope isolation, hostile generated content,
forbidden resource/navigation attempts, malformed messages and permitted
interaction. Keep browser-isolation evidence distinct from model usefulness.
Do not require seven component families or a universal renderer before delivery.

#10 memory/learning and #11 portability remain sequenced work, not prerequisites
for this checkpoint. Preserve their ownership, access/correction/forgetting rules.
The recorded synthetic route and **one cumulative $20** limit remain; historical
reservations/unknown liabilities are not reset. Default merge, deployment, new
paid routes, broader private data and external business effects remain excluded.
