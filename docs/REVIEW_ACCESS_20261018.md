# Development review access — October 18

Running application: `f9179a01c711bbb9d02f5f4eb57d46c42a0920e9`, frozen directory
`/home/ubuntu/workagent-candidates/f9179a0`. All three development services restarted
2026-10-18 01:30:04 UTC. Web build `fwb8IMkPdDNGS__bEwy_6` was built with natural
admission enabled at `907f4b6` (Claude owner `ddd4acc`, including `60cda46`) and reused
after byte-identity checks. Process working directories and loaded startup paths
were independently verified. A tenth human turn completed on this candidate.
This is an existing loopback development stack, not a production deployment.

## Authenticated entry

Use your existing SSH identity to the host:

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3152:127.0.0.1:3152 ubuntu@16.148.68.248
```

Then open the actual saved, corrected workshop table:

http://127.0.0.1:3152/conversations/330cbba6-0b3d-4bfd-8d01-d45ffe1d76ca/artifacts/af1f310c-ab43-4e6e-819b-ee8deae010b8?workspace=overnight-1a6b0b4cea30

Conversation (ordinary replies, attachments and subsequent work):

http://127.0.0.1:3152/conversations/330cbba6-0b3d-4bfd-8d01-d45ffe1d76ca?workspace=overnight-1a6b0b4cea30

If local port3152 is occupied, forward local13152 to remote3152 and substitute
13152 in the browser URLs. The local proxy supplies the retained domain credential;
no key or bearer token should be pasted into the browser or chat.

## What is and is not verified

Host checks confirm public host address16.148.68.248, SSH listener22 and API/web
bound only to127.0.0.1:8152/3152. The real browser used the authenticated local
proxy. SSH authentication/routing from your device has not been tested here.
Phone evidence is Chromium390×844 emulation, not a physical-phone access test.
On a phone, use a secure existing SSH-tunnel arrangement; the phone's127.0.0.1
is not your desktop or this server. No new public listener was opened.

## Important current limitation

Home's composer still selects the first historical workspace rather than the one
with usable standing authority. The live Home request failed with its draft kept;
that failure is retained and assigned to Claude in PR #9 comment6243959390. The
Home feed aggregation is a separate, already-fixed behavior. Use the direct
conversation above for the functioning review path; this is not a claim that
ordinary Home admission is accepted.

The approved worker now performs real model-backed work under the conserved
cumulative$50 authorization. Its current bounded allowance is finite; older held
unknown requests and human-paused responsibilities remain preserved, not replayed.
No outbound purchase, message or other business effect is enabled by this review.
