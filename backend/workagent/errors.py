from .models import ErrorCode, ErrorDetails, ErrorEnvelope

STATUS = {c: 409 for c in ErrorCode}
STATUS.update({ErrorCode.not_found_or_not_authorized: 404, ErrorCode.unauthenticated: 401,
               ErrorCode.validation_error: 422, ErrorCode.unsupported_operation: 422,
               ErrorCode.source_unavailable: 409, ErrorCode.connection_required: 409,
               ErrorCode.internal_error: 500})
MESSAGES = {
    'not_found_or_not_authorized': ('Resource unavailable.', 'Check your workspace and current access.'),
    'unauthenticated': ('Authentication required.', 'Provide the configured local bearer credential.'),
    'version_conflict': ('The current version changed.', 'Refresh current work and review a new proposal against that base.'),
    'command_conflict': ('This command ID has a different payload.', 'Use the original payload or a new command ID for a different intent.'),
    'source_changed': ('A selected source version changed.', 'Refresh sources and start scoped work with current dependencies.'),
    'source_unavailable': ('A selected source is unavailable.', 'Restore source access before continuing.'),
    'action_unresolved': ('The result is not verified.', 'Inspect the recorded state; do not blindly resubmit.'),
    'validation_error': ('Request validation failed.', 'Correct the named fields and retry.'),
}

class DomainError(Exception):
    def __init__(self, code: str, **details):
        self.code = ErrorCode(code)
        self.details = ErrorDetails(**details)
        super().__init__(code)

    def envelope(self, request_id):
        message, next_action = MESSAGES.get(self.code.value, ('Operation cannot proceed.', 'Review current state and authority before retrying.'))
        return ErrorEnvelope(code=self.code, message=message, request_id=request_id,
                             next_action=next_action, details=self.details)


def deny():
    raise DomainError('not_found_or_not_authorized')
