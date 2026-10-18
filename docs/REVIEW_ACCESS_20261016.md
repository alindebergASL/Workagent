# Authenticated development review access

Application: frozen `41a373965fd6aed6fdd6d55599a265515017cd9e`, build `S3q1X0z3unkcQp8UaAsyV`.
This is a development review, not production deployment or alpha acceptance.

## Open from your computer

Use the same existing SSH identity that grants you access to this host:

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3152:127.0.0.1:3152 ubuntu@16.148.68.248
```

Keep that connection open, then open:

http://127.0.0.1:3152/conversations/330cbba6-0b3d-4bfd-8d01-d45ffe1d76ca?workspace=overnight-1a6b0b4cea30

This shows the actual simple answer and shorter follow-up, not a fixture replay.

Editable supply work:

http://127.0.0.1:3152/conversations/e47c5239-f10b-42dd-a9db-bfda6520dbe9/artifacts/3576f3e3-8e16-4f84-8814-04c9147c74b8?workspace=overnight-1a6b0b4cea30

If local3152 is occupied, use `-L 127.0.0.1:13152:127.0.0.1:3152` and change the browser URL port to13152. Supply your normal `-i` option if your SSH identity is not selected automatically. Do not send private keys or passwords in chat.

Authentication is at SSH. No new public web listener or anonymous tunnel was created; app3152 and API8152 remain bound to host loopback. Do not forward the API or change local bind to0.0.0.0. No provider key is delivered to the browser. This route grants the existing development principal, not a new multi-user product-login implementation.

## Verified versus not verified

Host-side verified: current public host address, SSH22 listening, public-key authentication enabled, password authentication disabled, TCP forwarding permitted, web/API loopback listeners, live app HTTP200 and actual browser reads/writes through the real backend. Host ED25519 public-key fingerprint:

`SHA256:i2Eg2A8nVUAC7Nco6zf3N+hpNJAQPlETb/JFyTyI4rA`

Not yet verified: your computer's SSH identity/configuration, network ingress and completed tunnel connection; your physical phone. The host has no loaded user SSH identity, so we do not claim a successful end-to-end user authentication test. The phone screenshots use actual Chromium390px mobile emulation, not a physical-phone test. They are application captures, not design concepts.

Only the existing three synthetic conversations are in the installed model scope. Starting an arbitrary new conversation does not enlarge that scope. Paid work still consumes the existing bounded allowance; no fresh grant was installed for review. Historical held requests remain visible and must not be blindly retried.
