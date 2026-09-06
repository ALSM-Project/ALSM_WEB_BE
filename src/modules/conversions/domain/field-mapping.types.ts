export interface LegacyFieldDescriptor {
  name: string;
  type: string;
  length: number;
  position: string;
}

export interface FieldComponentMapping {
  componentType: string;
  labelText: string;
  isRequired: boolean;
  minLength: number;
  maxLength: number;
  regexPattern: string;
}

export interface FieldMappingEntry {
  legacyField: LegacyFieldDescriptor;
  componentMapping: FieldComponentMapping;
}

export interface FieldMappingRecord {
  id: string;
  organizationId: string;
  projectId: string;
  screenId: string;
  mappings: FieldMappingEntry[];
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FieldMappingRepository {
  findByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<FieldMappingRecord | null>;

  upsert(input: {
    organizationId: string;
    projectId: string;
    screenId: string;
    mappings: FieldMappingEntry[];
    updatedBy: string;
  }): Promise<FieldMappingRecord>;
}

export const FIELD_MAPPING_REPOSITORY = Symbol('FIELD_MAPPING_REPOSITORY');
