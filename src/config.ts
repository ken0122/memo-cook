import { homedir } from "node:os";
import { resolve } from "node:path";

export const defaultHome = resolve(homedir(), ".memo-cook");

export function resolveMemoHome(explicitHome?: string): string {
  return resolve(explicitHome ?? process.env.MEMO_COOK_HOME ?? defaultHome);
}
