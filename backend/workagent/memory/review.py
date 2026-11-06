"""Human review transitions, never inferred from source or model text."""
from ..errors import DomainError


def changes(old, command, principal):
    if old.kind == 'procedure' and command.decision == 'accept' and (
        old.procedure is None or not (old.applicability or '').strip() or not (old.confidence_basis or '').strip()):
        raise DomainError('action_unresolved')
    if old.status not in ('candidate', 'active', 'contested'):
        raise DomainError('action_unresolved')
    if old.exception_to_revision_id and command.decision == 'reject':
        # Rejecting only an exception is not whole-item expiry.
        raise DomainError('action_unresolved')
    return dict(status={'accept': 'active', 'dispute': 'contested', 'reject': 'expired'}[command.decision],
                exception_to_revision_id=old.exception_to_revision_id,
                origin='human_reviewed', reviewed_by_principal_id=principal.id,
                confidence_label=('uncertain' if command.decision == 'dispute' else
                                  'inferred' if old.kind == 'procedure' else 'explicit'))
