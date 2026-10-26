import {
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type FDCodeProjectFile,
} from "@fdcode/contracts";
import { parseFDCodeProjectFile } from "@fdcode/shared/t3ProjectFile";
import { executeAtomQuery } from "@fdcode/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readFDCodeProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<FDCodeProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    T3_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.truncated) return null;
  return parseFDCodeProjectFile(data.contents);
}
