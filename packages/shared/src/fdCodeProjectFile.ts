import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { FDCodeProjectFile, FDCODE_PROJECT_FILE_SCHEMA_URL } from "@fdcode/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const FDCodeProjectFileFromJson = fromLenientJson(FDCodeProjectFile);

const decodeFDCodeProjectFile = Schema.decodeExit(FDCodeProjectFileFromJson);

export function parseFDCodeProjectFile(contents: string): FDCodeProjectFile | null {
  const decoded = decodeFDCodeProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function buildFDCodeProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(FDCodeProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: FDCODE_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
