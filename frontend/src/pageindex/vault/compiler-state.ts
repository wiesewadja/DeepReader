import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "path";
import type { CompilerState } from "./compiler-types";

const STATE_FILE = "compiler-state.json";
const SNAPSHOTS_FILE = "link-snapshots.json";

export function loadCompilerState(indexPath: string): CompilerState | null {
  const statePath = join(indexPath, STATE_FILE);
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf-8"));
}

export function saveCompilerState(indexPath: string, state: CompilerState): void {
  if (!existsSync(indexPath)) mkdirSync(indexPath, { recursive: true });
  const statePath = join(indexPath, STATE_FILE);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/** 加载链接快照 */
export function loadLinkSnapshots(indexPath: string): Record<string, string[]> {
  const path = join(indexPath, SNAPSHOTS_FILE);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** 保存链接快照 */
export function saveLinkSnapshots(
  indexPath: string,
  snapshots: Record<string, string[]>
): void {
  if (!existsSync(indexPath)) mkdirSync(indexPath, { recursive: true });
  writeFileSync(join(indexPath, SNAPSHOTS_FILE), JSON.stringify(snapshots, null, 2));
}
