import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(fdCodeHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(fdCodeHome)) {
    return Option.none();
  }
  const trimmed = fdCodeHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly fdCodeHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.fdCodeHome), () =>
    input.joinPath(input.homeDirectory, ".fd-code"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly fdCodeHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.fdCodeHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
