export type JavaMemberKind = 'CLASS' | 'METHOD';

export interface MethodMappingEntry {
  /** Which generated .java file this member was detected in, e.g. "cobolprogramclasses/cbact01c/Cbact01cTasklet.java". */
  relativePath: string;
  kind: JavaMemberKind;
  /** The name tool2java actually generated — real, detected from the generated source, never fabricated. */
  originalName: string;
  /** The user's override. Equal to originalName until the user renames it. */
  targetName: string;
}

export interface MethodMappingRecord {
  id: string;
  organizationId: string;
  projectId: string;
  screenId: string;
  entries: MethodMappingEntry[];
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MethodMappingRepository {
  findByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<MethodMappingRecord | null>;

  upsert(input: {
    organizationId: string;
    projectId: string;
    screenId: string;
    entries: MethodMappingEntry[];
    updatedBy: string;
  }): Promise<MethodMappingRecord>;
}

export const METHOD_MAPPING_REPOSITORY = Symbol('METHOD_MAPPING_REPOSITORY');
