const fs = require("fs");
const path = require("path");
const os = require("os");

module.exports = async function (payload) {
  const dir = payload && payload.dir ? payload.dir.replace(/^~(?=$|\/)/, os.homedir()) : os.homedir();
  const abs = path.resolve(dir);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    throw new Error("Cannot read " + abs + ": " + e.message);
  }
  const items = [];
  for (const ent of entries) {
    const full = path.join(abs, ent.name);
    let size = null, isDir = ent.isDirectory();
    try {
      const st = fs.statSync(full);
      if (ent.isSymbolicLink()) isDir = st.isDirectory();
      if (!isDir) size = st.size;
    } catch (e) { /* unreadable entry; show without size */ }
    items.push({ name: ent.name, isDir, size });
  }
  items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  return { dir: abs, parent: path.dirname(abs), isRoot: abs === path.parse(abs).root, home: os.homedir(), items };
};
