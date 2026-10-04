import { ConflictException, NotFoundException } from '@nestjs/common';
import { OnboardUserService } from '../src/modules/users/application/onboard-user.service';
import { UserRepository } from '../src/modules/users/domain/user.repository';
import { OrganizationRepository } from '../src/modules/organizations/domain/organization.repository';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { RbacService } from '../src/modules/rbac/application/rbac.service';
import { EmailPort } from '../src/modules/auth/domain/email.port';
import { PasswordResetRepository } from '../src/modules/auth/domain/password-reset.repository';

describe('OnboardUserService (UC-82)', () => {
  let config: { get: jest.Mock };
  let users: jest.Mocked<UserRepository>;
  let organizations: jest.Mocked<OrganizationRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let email: jest.Mocked<EmailPort>;
  let passwordResets: jest.Mocked<PasswordResetRepository>;
  let organizationContext: jest.Mocked<OrganizationContextService>;
  let rbacService: jest.Mocked<Pick<RbacService, 'getRoleById' | 'updateUserRoles'>>;
  let service: OnboardUserService;

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue('http://localhost:3002') };
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    organizations = {
      addMember: jest.fn(),
    } as unknown as jest.Mocked<OrganizationRepository>;

    audit = { append: jest.fn() } as unknown as jest.Mocked<AuditRepository>;
    email = { send: jest.fn() } as unknown as jest.Mocked<EmailPort>;
    passwordResets = { create: jest.fn() } as unknown as jest.Mocked<PasswordResetRepository>;

    organizationContext = {
      resolve: jest.fn(),
    } as unknown as jest.Mocked<OrganizationContextService>;

    rbacService = {
      getRoleById: jest.fn(),
      updateUserRoles: jest.fn(),
    };

    service = new OnboardUserService(
      config as never,
      users,
      organizations,
      audit,
      email,
      passwordResets,
      organizationContext,
      rbacService as never,
    );
  });

  const baseInput = {
    email: 'staff@acmecorp.com',
    fullName: 'New Staff',
    role: 'TEAM_LEAD',
    actorUserId: 'admin-1',
  };

  it('rejects a duplicate email with a conflict', async () => {
    users.findByEmail.mockResolvedValue({ id: 'existing' } as never);

    await expect(service.execute(baseInput)).rejects.toThrow(ConflictException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    users.findByEmail.mockResolvedValue(null);
    rbacService.getRoleById.mockRejectedValue(new NotFoundException());

    await expect(service.execute(baseInput)).rejects.toThrow(NotFoundException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it('creates a staff account, assigns role/org, sends invite email, and audits', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue({
      id: 'user-1',
      email: 'staff@acmecorp.com',
      fullName: 'New Staff',
    } as never);
    rbacService.getRoleById.mockResolvedValue({ id: 'TEAM_LEAD' } as never);
    rbacService.updateUserRoles.mockResolvedValue([]);
    organizationContext.resolve.mockResolvedValue({ id: 'org-1' } as never);
    organizations.addMember.mockResolvedValue(undefined);
    passwordResets.create.mockResolvedValue({ id: 'reset-1' } as never);

    const result = await service.execute(baseInput);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'staff@acmecorp.com',
        isActive: true,
        isEmailVerified: false,
      }),
    );
    expect(rbacService.updateUserRoles).toHaveBeenCalledWith('user-1', ['TEAM_LEAD']);
    expect(organizations.addMember).toHaveBeenCalledWith('org-1', {
      userId: 'user-1',
      role: 'MEMBER',
    });
    expect(passwordResets.create).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'staff@acmecorp.com' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_ONBOARDED', resourceId: 'user-1' }),
    );
    expect(result.id).toBe('user-1');
  });

  it('does not audit when user creation fails', async () => {
    users.findByEmail.mockResolvedValue(null);
    rbacService.getRoleById.mockResolvedValue({ id: 'TEAM_LEAD' } as never);
    users.create.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.execute(baseInput)).rejects.toThrow('storage unavailable');
    expect(audit.append).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});
