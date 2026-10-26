import {
  FDCODE_PROJECT_FILE_NAME,
  LEGACY_PROJECT_FILE_NAME,
  type EnvironmentId,
  type FDCodeProjectFile,
} from "@fdcode/contracts";
import { parseFDCodeProjectFile } from "@fdcode/shared/fdCodeProjectFile";
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
  for (const fileName of [FDCODE_PROJECT_FILE_NAME, LEGACY_PROJECT_FILE_NAME]) {
    const result = await executeAtomQuery(
      appAtomRegistry,
      getProjectFileQueryAtom(environmentId, workspaceRoot, fileName),
      { reportDefect: false, reportFailure: false },
    );
    const data = resolveProjectFileQueryData(
      environmentId,
      workspaceRoot,
      fileName,
      result._tag === "Success" ? result.value : null,
    );
    if (data === null) continue;
    return data.truncated ? null : parseFDCodeProjectFile(data.contents);
  }
  return null;
}
