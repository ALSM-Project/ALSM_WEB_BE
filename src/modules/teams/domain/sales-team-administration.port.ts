export interface SalesTeamAdministration {
  organization(
    userId: string,
    organizationHeader: string | undefined,
  ): Promise<{ organizationId: string }>;
  authorize(
    userId: string,
    organizationHeader: string | undefined,
    teamId: string,
    salespersonId?: string,
  ): Promise<{ organizationId: string }>;
  customer(organizationId: string, customerUserId: string): Promise<boolean>;
}
export const SALES_TEAM_ADMINISTRATION = Symbol('SALES_TEAM_ADMINISTRATION');
