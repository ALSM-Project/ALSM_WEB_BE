export enum TeamKind {
  SALES = 'SALES',
  CONVERSION = 'CONVERSION',
}

export interface TeamProjectAssignment {
  projectId: string;
  memberIds: string[];
}

export interface TeamRecord {
  id: string;
  organizationId: string;
  name: string;
  kind: TeamKind;
  memberIds: string[];
  managerIds: string[];
  projectAssignments: TeamProjectAssignment[];
  revision: number;
  replayedCreation?: boolean;
}

export interface SaveTeamInput {
  id?: string;
  creationId?: string;
  organizationId: string;
  actorUserId: string;
  name: string;
  kind: TeamKind;
  memberIds: string[];
  managerIds: string[];
  projectAssignments: TeamProjectAssignment[];
  expectedRevision: number;
}

export interface TeamRepository {
  findById(id: string, organizationId: string): Promise<TeamRecord | null>;
  findManaged(
    id: string,
    organizationId: string,
    managerId: string,
    kind: TeamKind,
  ): Promise<TeamRecord | null>;
  listManaged(organizationId: string, managerId: string, kind: TeamKind): Promise<TeamRecord[]>;
  save(input: SaveTeamInput): Promise<TeamRecord | null>;
}

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');
