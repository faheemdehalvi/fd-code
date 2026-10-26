import {
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type FDCodeProjectFile,
  type FDCodeProjectFileScript,
} from "@fdcode/contracts";
import { parseFDCodeProjectFile } from "@fdcode/shared/t3ProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<FDCodeProjectFileScript> = [];

export interface FDCodeProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: FDCodeProjectFile | null;
  scripts: ReadonlyArray<FDCodeProjectFileScript>;
}

export function useFDCodeProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): FDCodeProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", T3_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseFDCodeProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useFDCodeProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<FDCodeProjectFileScript> {
  return useFDCodeProjectFileState(environmentId, cwd).scripts;
}
