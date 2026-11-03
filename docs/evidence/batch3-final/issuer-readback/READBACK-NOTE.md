# Readback note — issuer SUMMARY.json cap fields are stale; 275 verified in prosrc

`SUMMARY.json` in this directory was produced by `evaluation/fresh72_issuer.py readback`,
whose `summary()` recognizes only the 100/175 cap bodies. The installed issuer is the
audited **275 successor** (installed 2026-11-02 via the locked exact-preimage mechanism;
receipts: `.local/batch3/b35e/OWNER-CEILING-RAISE-275/`). Therefore in SUMMARY.json:

- `installed_issuer_cap_usd: "unrecognized"` and `cumulative_ceiling_usd: "175"` and
  `available_for_incremental_certificates_usd: "-15.0597"` are **stale parser defaults** —
  they do NOT reflect installed authority.
- All ledger totals in the same file ARE exact live readbacks and are the cited numbers:
  certificates 122.00, released 31.54626, conservative encumbered 190.0597
  (= 99.605960 − 31.54626 + 122.00), known usage upper 6.94086, unresolved reserves 0.39576.

The 275 cap is verified directly against the database function source at readback time
(2026-11-03T01:1xZ, this card):

    sudo -u postgres psql -XqAt -d workagent_test_47b87fe3b82e -c \
      "SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='test_budget_correction' AND p.proname='issue_exact'"
    → contains: IF 99.605960-released+allocated+amount>275 THEN RAISE EXCEPTION 'cumulative_275_exceeded'; END IF;

Correct headroom at the installed cap: **275 − 190.0597 = 84.9403 USD** for new
incremental certificates. `SNAPSHOT.json` (sibling, untracked working copy in
`.local/batch3/b3final/issuer-readback/`) retains the full function source and comment
(`cumulative_ceiling_usd=275`, `plus100_by_owner_2026-11-02`) as the binding proof.
