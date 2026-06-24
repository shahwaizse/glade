// Mock fallback harness that succeeds. Echoes back what it observed in the
// prompt (read from stdin, matching how Glade feeds real harnesses) so the
// test can confirm the continuation note + image path arrived.
const fs = require("fs");
let prompt = "";
try { prompt = fs.readFileSync(0, "utf8"); } catch {}
const sawImage = /uploads[\\/]glade-/.test(prompt);
const sawContinuation = /hit its usage limit/i.test(prompt);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "assistant", message: { content: [
  { type: "text", text: "picking up where the previous harness left off" },
  { type: "tool_use", name: "Write", input: { file_path: "web/widgets/demo/widget.js" } },
] } });
out({ type: "result", subtype: "success", is_error: false,
      result: `built it (image=${sawImage ? "yes" : "no"}, continued=${sawContinuation ? "yes" : "no"})` });
process.exit(0);
