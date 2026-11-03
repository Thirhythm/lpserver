import { joinOpenlistPath } from "./paths.js";

export interface ModuleDefinition {
  readonly openlistPath: string;
}

export const MODULES = {
  sympathy: { openlistPath: "SongPackages/Sympathy" },
} as const satisfies Readonly<Record<string, ModuleDefinition>>;

export type ModuleName = keyof typeof MODULES;

export class ModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleError";
  }
}

export function resolveModule(
  rawName: unknown,
  basePath: string,
): { name: ModuleName; openlistPath: string } {
  const validValues = Object.keys(MODULES).join(", ");
  if (typeof rawName !== "string" || rawName.trim() === "") {
    throw new ModuleError(`module is required; valid values: ${validValues}`);
  }
  const name = rawName.trim();
  if (!Object.hasOwn(MODULES, name)) {
    throw new ModuleError(`invalid module '${name}'; valid values: ${validValues}`);
  }
  const moduleName = name as ModuleName;
  return {
    name: moduleName,
    openlistPath: joinOpenlistPath(basePath, MODULES[moduleName].openlistPath),
  };
}
