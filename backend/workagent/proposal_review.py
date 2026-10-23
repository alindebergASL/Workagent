"""Read-time structural loss review. Saved bodies are inert, untrusted data.

A removal is a missing structural member or a replaced nonempty value. Lists
with stable identities are compared by identity; other lists are multisets.
Each deleted subtree counts once; changed surviving leaves count separately.
Document block text additions retaining the exact old string are safe, but notes (list entries)
must survive exactly. This is deliberately structural, not semantic: paraphrases,
identity changes and code replacements can warn even when useful, and retained
text may acquire a different meaning. Acknowledgement permits these edits; it
never merges or rewrites proposal bytes. Display is bounded, detection is not.
"""
import json
from collections import Counter

from .models import ProposalReview, RemovedContent

DISPLAY_LIMIT = 20
BEFORE_LIMIT = 500
IDENTITIES = ('block_id', 'row_id', 'field_key', 'key', 'name')
# Only known root metadata is derived. User columns may have these same names.
BODY_METADATA = {'file': frozenset({'content_sha256'}),
                 'custom_view': frozenset({'access_generation'})}


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _part(value):
    return str(value).replace('~', '~0').replace('/', '~1')


def removed_content(before, after):
    """Return bounded entries and the complete structural-removal count."""
    before = before.model_dump(mode='json') if hasattr(before, 'model_dump') else before
    after = after.model_dump(mode='json') if hasattr(after, 'model_dump') else after
    entries = []
    count = 0

    def record(path, value):
        nonlocal count
        count += 1
        if len(entries) < DISPLAY_LIMIT:
            text = value if isinstance(value, str) else _json(value)
            if len(text) > BEFORE_LIMIT:
                text = text[:BEFORE_LIMIT - 1] + '…'
            entries.append(RemovedContent(path=path or '/', before=text))

    def walk(old, new, path):
        if type(old) is type(new) and old == new:
            return
        if isinstance(old, dict) and isinstance(new, dict):
            for key, value in old.items():
                if not path and key in BODY_METADATA.get(before.get('kind'), ()):
                    continue
                child = path + '/' + _part(key)
                if key not in new:
                    record(child, value)
                else:
                    walk(value, new[key], child)
        elif isinstance(old, list) and isinstance(new, list):
            # Stable identities preserve provenance through reordering. Never
            # infer row identity from business values, dates or domain labels.
            identity = next((key for key in IDENTITIES if old and
                all(isinstance(x, dict) and isinstance(x.get(key), str) for x in old + new) and
                len({x[key] for x in old}) == len(old) and
                len({x[key] for x in new}) == len(new)), None)
            if identity:
                indexed = {x[identity]: x for x in new}
                for value in old:
                    child = path + '/' + _part(value[identity])
                    if value[identity] not in indexed:
                        record(child, value)
                    else:
                        walk(value, indexed[value[identity]], child)
            else:
                # Notes and legacy rows have no stable ID. Exact multisets
                # avoid false losses on reorder while retaining duplicate counts.
                remaining = Counter(_json(x) for x in new)
                for index, value in enumerate(old):
                    key = _json(value)
                    if remaining[key]:
                        remaining[key] -= 1
                    else:
                        record(path + '/' + str(index), value)
        elif old is not None and old != '':
            prose = path.startswith('/blocks/') and path.count('/') == 3 and path.endswith('/text')
            if prose and isinstance(old, str) and isinstance(new, str) and old in new:
                return
            record(path, old)

    walk(before, after, '')
    return entries, count


def review_proposal(proposal, base_body, latest_pending_proposal_id):
    entries, count = removed_content(base_body, proposal.body)
    return ProposalReview(latest_pending_proposal_id=latest_pending_proposal_id,
        is_latest=proposal.id == latest_pending_proposal_id,
        removed_content=entries, removed_content_count=count)
