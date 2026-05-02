import { readFile } from "node:fs/promises";
import path from "node:path";

const checks = [
  {
    file: path.join(process.cwd(), "public", "index.html"),
    required: 'const API_BASE = window.location.origin.replace(/\\/$/, "");'
  },
  {
    file: path.join(process.cwd(), "public", "admin.html"),
    required: 'const API_BASE = window.location.origin.replace(/\\/$/, "");'
  }
];

const disallowedPatterns = [/https:\/\/[a-z0-9-]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com/gi];

for (const check of checks) {
  const content = await readFile(check.file, "utf8");

  if (!content.includes(check.required)) {
    throw new Error(`${path.basename(check.file)} must resolve API_BASE from window.location.origin`);
  }

  for (const pattern of disallowedPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      throw new Error(`${path.basename(check.file)} contains a hardcoded API origin: ${matches[0]}`);
    }
  }
}

console.log("shell API origin check passed");
