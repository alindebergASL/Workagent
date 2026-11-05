"""Future-only reviewed resume/changed-input admission, never a frozen campaign.

The entrypoint accepts receipts from explicit post_freeze_packets.review_proposal
operations; it does not choose/accept proposals. A workspace write lock and one
ordinary transaction cover current review checks, recollection, exact target
admission and immutable command evidence. No worker or provider is invoked.
"""
from contextlib import contextmanager
from hashlib import sha256
from typing import Literal
from pydantic import Field

from workagent.errors import DomainError
from workagent.model_base import Model, Id, Text
from workagent.models import Command, ExactTarget, AttachmentInput, PostMessage, MessageQueued
from workagent.service import Service, canonical, digest
from post_freeze_packets import collect_packet, require_reviewed_transition


class Transition(Command):
    kind: Literal['resume', 'changed-input']
    source_run_id: Id
    conversation_id: Id
    saved: ExactTarget
    receipts: dict[str, dict]
    protected_text: list[Text] = Field(min_length=1, max_length=20)
    expected_work_version: int = Field(ge=1)
    text: Text
    changed_inputs: list[AttachmentInput] = Field(default_factory=list, max_length=1)


class TransitionReceipt(Model):
    transition_id: Id
    kind: Literal['resume', 'changed-input']
    saved: ExactTarget
    review_receipts: dict[str, dict]
    source_packet: dict
    source_packet_sha256: str
    saved_input_sha256: str
    admission: MessageQueued
    human_time_measured: Literal[False] = False
    scoring: Literal['unscored'] = 'unscored'


class _TransactionDatabase:
    """Borrow this call's connection, not a cache or a replacement authority."""
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def transaction(self):
        # Ordinary Service calls must not open/commit separate transactions while
        # the outer workspace UPDATE lock is held. All errors roll back the unit.
        yield self.connection


def _checked_input(service, principal, workspace, command):
    if not command.receipts:
        raise DomainError('review_required', fields=['review_receipt'])
    proof = require_reviewed_transition(service, principal, workspace,
                                        command.saved.artifact_id, command.receipts)
    if proof != command.saved.model_dump():
        raise DomainError('source_changed')
    artifact = service.get_artifact(principal, workspace, command.saved.artifact_id)
    source = service.get_run(principal, workspace, command.source_run_id)
    if (artifact.conversation_id != command.conversation_id
            or source.conversation_id != command.conversation_id):
        raise DomainError('not_found_or_not_authorized')
    body = artifact.current_revision.body
    text = getattr(body, 'content', '') or '\n'.join(b.text for b in getattr(body, 'blocks', []))
    if not all(part in text for part in command.protected_text):
        raise DomainError('validation_error')
    # Exact saved body JSON, openly identified as prior work, not fabricated
    # model Markdown. Target independently binds artifact/revision/body hash.
    return AttachmentInput(filename='reviewed-saved-work.json', mime_type='text/plain',
                           content=canonical(body))


def admit_transition(service, principal, workspace, command: Transition):
    """Perform ONE ordinary dependent admission, atomically retaining its packet.

    Explicit review happens through ordinary review_proposal beforehand. A failed
    acknowledgment cannot create a receipt; pending proposals still deny here.
    Retry with the same command after Service/process recreation is idempotent.
    Current review/access checks run even on retry; later human edits deny it.
    """
    with service.db.transaction() as connection:
        service._scope(connection, principal, workspace, write=True)
        scoped = Service(_TransactionDatabase(connection),
                         allow_controlled_turns=service.allow_controlled_turns)
        saved_input = _checked_input(scoped, principal, workspace, command)
        packet = collect_packet(scoped, principal, workspace, command.source_run_id)
        post = PostMessage(schema_version=command.schema_version, request_id=command.request_id,
            command_id=digest({'future_transition_post': command.command_id}),
            expected_work_version=command.expected_work_version, text=command.text,
            target=command.saved, attachments=[saved_input, *command.changed_inputs])
        # Ordinary current conversation/target/source authority, admission and CAS.
        # Even a transition-receipt retry invokes post_message's current auth and
        # its exact payload-bound command receipt, never a reconstructed run.
        admitted = scoped.post_message(principal, workspace, command.conversation_id, post)
        result = TransitionReceipt(transition_id=command.command_id, kind=command.kind,
            saved=command.saved, review_receipts=command.receipts, source_packet=packet,
            source_packet_sha256=digest(packet),
            saved_input_sha256=sha256(saved_input.content.encode()).hexdigest(), admission=admitted)
        # Persist evidence in the existing immutable command ledger. A conflict
        # here rolls back the post too. Retries return the ORIGINAL source packet.
        return scoped._command(principal, workspace, 'future_reviewed_transition',
            {'conversation_id': command.conversation_id}, command, TransitionReceipt,
            lambda c: None, lambda c, _: result)
