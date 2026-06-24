// Mock harness that always reports a usage limit, to exercise Glade's failover.
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "assistant", message: { content: [{ type: "text", text: "starting on it" }] } });
// Claude-style terminal result that signals the account is rate limited.
out({ type: "result", subtype: "error_during_execution", is_error: true,
      result: "Claude AI usage limit reached. Please try again later." });
process.stderr.write("error: usage limit reached (429)\n");
process.exit(1);
