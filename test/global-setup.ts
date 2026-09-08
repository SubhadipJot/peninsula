import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// E2E tests spawn the built CLI, so make sure dist/ is fresh before any test runs.
// Run tsc through the current node binary: avoids shell/.cmd spawn issues.
export function setup(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  execFileSync(process.execPath, [tsc], { cwd: root, stdio: "inherit" });
}
