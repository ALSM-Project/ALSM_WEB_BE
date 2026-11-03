/** Opaque transaction handle: application code cannot issue database commands. */
export interface DiagnosticReadTransaction {
  readonly session: unknown;
  readonly connection: unknown;
}
export interface DiagnosticReadQuery {
  organizationId: string;
  projectId?: string;
  id?: string;
  afterId?: string;
  limit: number;
  kind: string;
}
export interface DiagnosticView {
  id: string;
  [field: string]: string | number | Date | null;
}
export interface DiagnosticRow {
  view: DiagnosticView;
  /** Internal ownership evidence, never spread into HTTP responses. */
  conversionJobId?: string;
}
export interface DiagnosticReader {
  read(query: DiagnosticReadQuery): Promise<DiagnosticRow[]>;
}
export interface DiagnosticReaderFactory {
  bind(transaction: DiagnosticReadTransaction): DiagnosticReader;
}
