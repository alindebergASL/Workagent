# Actual saved model investigation — unedited content

Official gpt-6.1-sol on application4e676b1; canonical state PARTIAL.
Original model body before reviewer note. No user acceptance.

## Support-ticket spike: evidence and living investigation brief

Working conclusion: week3 has a higher ticket rate, not just more active users. The release and ticket-form change coincide with that increase, so neither is a confirmed cause. The supplied evidence does not establish that the increase represents more underlying incidents rather than changes in reporting. This is an updateable investigation brief, not a verified production finding.

Supplied observations and descriptive calculations

Week1: 20 tickets / 200 active users = 10 tickets per 100 active users. Week2: 24 / 240 = 10 per 100. Week3: 48 / 300 = 16 per 100. From week2 to week3, tickets rose 100%, active users rose 25%, and tickets per active user rose 60% (6 more tickets per 100 active users). These are ticket rates, not percentages of users affected: unique ticket submitters and repeat tickets are unknown.

At the week1–2 rate of 0.10 tickets per active user, 300 active users would correspond to 30 tickets. Week3 has 18 more tickets than that descriptive benchmark. Of the 24-ticket increase from week2, 6 correspond to user-count growth at the old rate and 18 to the higher observed rate. This arithmetic is conditional on treating the earlier rate as a benchmark; it is not an estimated causal effect, a forecast, or proof of an anomaly beyond ordinary variation.

Week3 categories: login 12 (25% of tickets; 4 per 100 active users), billing 18 (37.5%; 6 per 100), mixed 18 (37.5%; 6 per 100). Billing is larger than login, but ties the mixed group. Earlier category counts are absent, so no category's contribution to the increase can be identified. In particular, the 18 billing tickets cannot be equated with the 18 tickets above the benchmark merely because the numbers match.

The release and ticket-form change both began at the start of week3. Two reports say a login error happened before the release, but timestamps are incomplete. These reports weaken a claim that all login errors first began with the release; they do not independently verify pre-release onset or rule out a release-related worsening, a different login error, or inaccurate recall. Event time and ticket-submission time must be distinguished.

Competing explanations — open, potentially overlapping

Release-related regression: compatible with the week3 timing, but timing alone does not isolate it from the form change or other changes. Useful distinguishing evidence, if supplied later: affected app versions, feature exposure, precise incident times, and comparable error descriptions before and after release. Version comparisons would still need attention to differences between user groups.

Reporting or classification change: the new form could change submission friction, duplicate submissions, what counts as a ticket, or category selection. No supplied evidence establishes that it did. Useful distinguishing evidence: old/new form definitions, counting and tagging rules, and any already available comparable submission or duplicate information.

Other possibilities: an older problem became more common or visible; user composition or usage intensity changed; billing-cycle effects or another coincident event contributed; ordinary variation accounts for some of the movement. Active-user counts adjust for population size only, not these differences. Two baseline weeks do not establish normal variability, seasonality, or a stable long-run rate.

Not supported: 'the release caused the spike'; 'the form caused the spike'; '16% of users had a problem'; 'billing drove the increase'; 'the two earlier reports exonerate the release'; or '18 tickets were caused by the release.' Statistical significance has not been established; assumptions about independent events, repeated users, and reporting consistency are unresolved.

Continuation plan — supplied or already authorized offline evidence only

First check comparability: record week boundaries, active-user definition, ticket-count definition, duplicates/reopens, category rules, and exactly what changed in the form. Leave unavailable fields marked unknown; do not treat absence of evidence as a negative finding.

If relevant records are supplied, separate incident time from submission time; record timestamp precision and source, release/form change times, affected version, symptom, and whether each report is firsthand or retrospective. Keep uncertain ordering explicitly uncertain.

If earlier category data become available, compare category-specific ticket rates with consistent definitions and denominators. Preserve original labels and notes; document any recoding separately. Separate duplicate reports from distinct incidents only when evidence permits.

As additional comparable weeks or pre-existing offline records are supplied, append counts and denominators, recalculate rates, and document other changes. A persistent higher rate would strengthen evidence of a sustained change, not by itself identify its cause. Do not impose an arbitrary causal or statistical threshold after inspecting results.

Reusable update entry: Evidence ID / date added / source and exact observation / period and population covered / event time vs submission time / timestamp precision / ticket and active-user definitions / duplicate or missing-data caveats / explanation(s) strengthened or weakened and why / unresolved alternatives / revision to working conclusion / human notes. Keep observations separate from interpretations, retain earlier entries, and mark corrections explicitly rather than silently replacing history.

Current unknowns: unique affected users; repeated tickets; historical category mix; precise incident timestamps; comparability of ticket collection before/after the form change; normal week-to-week variability; version exposure; usage intensity and user mix; whether the two earlier login reports describe the same error. Highest-value next input: any existing offline description of the form/counting changes, followed by comparable earlier category counts and timing evidence. None is required to retain the present cautious conclusion.

Human constraints: “We cannot access production or contact users. Don't call a correlation a confirmed cause.” No production access, user contact, external monitoring, or data collection has been performed or arranged. Future updates require evidence to be supplied in this conversation; the brief does not update automatically.
