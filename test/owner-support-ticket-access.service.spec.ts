import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OwnerSupportTicketAccessService } from '../src/modules/organizations/application/owner-support-ticket-access.service';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';

const actorUserId = '111111111111111111111111';
const organizationId = '222222222222222222222222';
const input = { actorUserId, organizationId, action: 'CREATE' } as const;

describe('Owner Support Ticket authority', () => {
  function fixture() {
    const organization = {
      id: organizationId,
      name: 'Owned',
      type: OrganizationType.ENTERPRISE,
      members: [{ userId: actorUserId, role: OrganizationRole.OWNER }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const context = { resolve: jest.fn().mockResolvedValue(organization) };
    const staff = { hasCurrentAssignment: jest.fn().mockResolvedValue(false) };
    const authority = new OwnerSupportTicketAccessService(
      context as never,
      new OrganizationAuthorizationService(),
      staff,
    );
    return { organization, context, staff, authority };
  }
  it('keeps captured identity while membership verification awaits', async () => {
    const f = fixture();
    let resolve!: (value: typeof f.organization) => void;
    f.context.resolve.mockReturnValue(
      new Promise((finish) => {
        resolve = finish;
      }),
    );
    const mutable = { ...input };
    const pending = f.authority.authorize(mutable);
    Object.assign(mutable, { actorUserId: 'forged', organizationId: 'foreign', action: 'REOPEN' });
    resolve(f.organization);
    expect(await pending).toBe(true);
    expect(f.context.resolve).toHaveBeenCalledWith(actorUserId, organizationId);
    expect(f.staff.hasCurrentAssignment).toHaveBeenCalledWith(actorUserId);
  });
  it('denies a foreign Organisation returned by an authority adapter', async () => {
    const f = fixture();
    f.organization.id = '333333333333333333333333';
    expect(await f.authority.authorize(input)).toBe(false);
    expect(f.staff.hasCurrentAssignment).not.toHaveBeenCalled();
  });
  it('denies duplicate Owner entries rather than selecting the first', async () => {
    const f = fixture();
    f.organization.members.push({ ...f.organization.members[0] });
    expect(await f.authority.authorize(input)).toBe(false);
  });
  it.each([undefined, null, 'false', 0])(
    'requires literal verified absence of a staff assignment (%s)',
    async (result) => {
      const f = fixture();
      f.staff.hasCurrentAssignment.mockResolvedValue(result);
      expect(await f.authority.authorize(input)).toBe(false);
    },
  );
  it.each(['', 'slug', 'A'.repeat(24)])(
    'does not resolve noncanonical Organisation %s',
    async (id) => {
      const f = fixture();
      expect(await f.authority.authorize({ ...input, organizationId: id })).toBe(false);
      expect(f.context.resolve).not.toHaveBeenCalled();
    },
  );
});
