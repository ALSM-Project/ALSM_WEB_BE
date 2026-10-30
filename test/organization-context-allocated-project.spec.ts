import { ForbiddenException } from '@nestjs/common';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';

const own = { id: 'org-internal', name: 'ALSM', type: 'INTERNAL', members: [{ userId: 'staff', role: OrganizationRole.MEMBER }] };
const customer = {
  id: 'org-customer',
  name: 'Customer',
  type: 'ENTERPRISE',
  members: [{ userId: 'owner', role: OrganizationRole.OWNER }],
};

describe('OrganizationContextService - project allocated to the caller (UC-86)', () => {
  const organizations = { findForMember: jest.fn(), findFirstForMember: jest.fn(), findById: jest.fn() };
  const projects = { findById: jest.fn() };
  const service = new OrganizationContextService(organizations as never, projects as never);
  const authorization = new OrganizationAuthorizationService();

  beforeEach(() => {
    jest.resetAllMocks();
    organizations.findFirstForMember.mockResolvedValue(own);
    organizations.findForMember.mockResolvedValue(null);
    organizations.findById.mockImplementation(async (id: string) => (id === 'org-customer' ? customer : own));
  });

  it("acts in the project's own organization for the staff member it was allocated to", async () => {
    projects.findById.mockResolvedValue({ id: 'p1', organizationId: 'org-customer', assignedStaffId: 'staff' });

    const organization = await service.resolve('staff', undefined, 'p1');

    expect(organization.id).toBe('org-customer');
    // Counted as a member for this request, so the usual role checks pass...
    expect(() => authorization.require(organization, 'staff', [OrganizationRole.MEMBER])).not.toThrow();
    // ...but only as a plain member: no owner or admin powers.
    expect(() => authorization.require(organization, 'staff', [OrganizationRole.OWNER, OrganizationRole.ADMIN])).toThrow(
      ForbiddenException,
    );
    // Nothing is stored: the real organization record still has only its owner.
    expect(customer.members).toHaveLength(1);
  });

  it.each([
    ['another staff member', { id: 'p1', organizationId: 'org-customer', assignedStaffId: 'someone-else' }],
    ['nobody', { id: 'p1', organizationId: 'org-customer' }],
    ['a deleted project', { id: 'p1', organizationId: 'org-customer', assignedStaffId: 'staff', deletedAt: new Date() }],
  ])('gives nothing extra when the project is allocated to %s', async (_label, project) => {
    projects.findById.mockResolvedValue(project);
    const organization = await service.resolve('staff', undefined, 'p1');
    expect(organization.id).toBe('org-internal');
  });

  it('behaves as before when no project is named, or when the project does not exist', async () => {
    expect((await service.resolve('staff')).id).toBe('org-internal');
    expect(projects.findById).not.toHaveBeenCalled();

    projects.findById.mockResolvedValue(null);
    expect((await service.resolve('staff', undefined, 'missing')).id).toBe('org-internal');
  });

  it('still refuses an organization the caller names without being a member, for an unallocated project', async () => {
    projects.findById.mockResolvedValue({ id: 'p1', organizationId: 'org-customer', assignedStaffId: 'someone-else' });
    await expect(service.resolve('staff', 'org-customer', 'p1')).rejects.toMatchObject({
      response: { code: 'ORGANIZATION_ACCESS_DENIED' },
    });
  });

  it('keeps the real membership when the allocated staff member already belongs to the organization', async () => {
    projects.findById.mockResolvedValue({ id: 'p1', organizationId: 'org-internal', assignedStaffId: 'staff' });
    const organization = await service.resolve('staff', undefined, 'p1');
    expect(organization.members).toEqual(own.members);
  });
});
