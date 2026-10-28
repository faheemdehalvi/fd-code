# OpenCode connection recovery

## Connection lifecycle

OpenCode 2 uses one server connection per provider instance. Threads in that instance share the
server and its event stream, while each thread keeps a separate native OpenCode session. FD CODE
subscribes to the event stream before it creates or resumes a session so it does not miss turn
events.

The server connection remains borrowed for the lifetime of the provider session. Closing the
session releases that borrow and its event subscription. For an external OpenCode server, closing
also makes a best-effort request to interrupt turns that would otherwise continue unseen.

## Recovery behavior

If the event stream ends, fails, or stops producing bytes, FD CODE reconnects at most five times,
waiting two seconds between attempts. New turns wait for recovery for at most 30 seconds. A user
Stop issued during recovery waits for the replacement connection and then interrupts the native
session; if recovery does not complete in time, FD CODE ends the local turn as interrupted rather
than submitting it again.

After reconnecting, FD CODE reads the server's active-session list and message history. It
backfills persisted assistant text and completed tool results, restores listed approvals and
structured questions, and cancels requests the server no longer lists. A persisted `idle` history
item supplies the authoritative outcome for a turn that ended while disconnected. If the session
is no longer active and has no such terminal item, the turn is marked interrupted, not successful.

Prompt IDs are deterministic for a session and run attempt. Recovery never resubmits a prompt,
and FD CODE does not replay tool calls. Background events held for a continuation are capped; if
the cap is exceeded, the continuation fails with instructions to review the native conversation
instead of replaying an incomplete event sequence.

## Failure outcomes

- Temporary transport or server-process failures recover through the bounded retry loop.
- Retry exhaustion fails every active turn once, marks its provider thread broken, puts the shared
  provider session in error, and closes its event stream.
- A rejected server password is not retried. Active turns fail with a permission error explaining
  that the configured password must be updated.
- Reconciliation is bounded to 15 seconds. A timeout counts as a failed reconnect attempt.
- Multiple native sessions are reconciled independently against the same active-session snapshot.

## Safe recovery

1. Keep the failed thread and its history; do not delete or recreate application data.
2. For a password rejection, update the OpenCode server password in the provider settings before
   retrying.
3. For an unavailable local server, let FD CODE restart it or restore the configured external
   server, then send a new message. Do not manually replay tool actions from the interrupted turn.
4. If a turn is marked interrupted or the background-event limit was reached, inspect the native
   OpenCode conversation and workspace before deciding what to run next.

## OpenCode 1.x limitation

The legacy OpenCode adapter cannot safely replace its SDK event subscription in place. A lost
stream therefore fails active turns, marks their native threads broken, and relies on the existing
replacement-session handoff for the next message. Persisted conversation data remains available,
but pending live approvals and questions do not survive that replacement. OpenCode 2 is required
for in-place reconnect and reconciliation.
