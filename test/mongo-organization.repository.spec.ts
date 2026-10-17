import { Model, Types } from 'mongoose';
import { MongoOrganizationRepository } from '../src/modules/organizations/infrastructure/mongo-organization.repository';
import { Organization } from '../src/modules/organizations/infrastructure/organization.schema';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';

describe('MongoOrganizationRepository read isolation', () => {
  const organizationA = new Types.ObjectId().toHexString();
  const organizationB = new Types.ObjectId().toHexString();
  const userId = new Types.ObjectId().toHexString();
  const document = {
    id: organizationA,
    name: 'A',
    type: OrganizationType.SELF_SERVICE,
    members: [{ userId: new Types.ObjectId(userId), role: OrganizationRole.OWNER }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const exec = jest.fn();
  const model = { findOne: jest.fn(() => ({ exec })), create: jest.fn() };
  const repository = new MongoOrganizationRepository(model as unknown as Model<Organization>);
  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockReset();
  });
  afterEach(() => {
    expect(model.create).not.toHaveBeenCalled();
  });

  it('does not fall back to A when its member requests B', async () => {
    exec.mockResolvedValueOnce(null).mockResolvedValue(document);
    await expect(repository.findForMember(organizationB, userId)).resolves.toBeNull();
    expect(model.findOne).toHaveBeenCalledTimes(1);
    expect(model.findOne).toHaveBeenCalledWith({
      $or: [{ _id: new Types.ObjectId(organizationB) }, { _id: organizationB }],
      'members.userId': { $in: [new Types.ObjectId(userId), userId] },
    });
  });

  it('returns the requested organization for its member', async () => {
    exec.mockResolvedValue(document);
    await expect(repository.findForMember(organizationA, userId)).resolves.toMatchObject({
      id: organizationA,
      members: [{ userId, role: OrganizationRole.OWNER }],
    });
    expect(model.findOne).toHaveBeenCalledWith({
      $or: [{ _id: new Types.ObjectId(organizationA) }, { _id: organizationA }],
      'members.userId': { $in: [new Types.ObjectId(userId), userId] },
    });
  });

  it('returns null for a nonexistent organization without creating it', async () => {
    exec.mockResolvedValue(null);
    await expect(
      repository.findForMember(new Types.ObjectId().toHexString(), userId),
    ).resolves.toBeNull();
    expect(model.findOne).toHaveBeenCalledTimes(1);
  });

  it('returns an existing first membership without provisioning', async () => {
    exec.mockResolvedValue(document);
    await expect(repository.findFirstForMember(userId)).resolves.toMatchObject({
      id: organizationA,
    });
    expect(model.findOne).toHaveBeenCalledWith({
      'members.userId': { $in: [new Types.ObjectId(userId), userId] },
    });
  });

  it('returns null when there is no first membership', async () => {
    exec.mockResolvedValue(null);
    await expect(repository.findFirstForMember(userId)).resolves.toBeNull();
    expect(model.findOne).toHaveBeenCalledTimes(1);
  });

  it.each([organizationB, undefined])(
    'context resolution denies missing membership for %s without provisioning',
    async (requestedOrganization) => {
      exec.mockResolvedValue(null);
      const context = new OrganizationContextService(repository);
      await expect(context.resolve(userId, requestedOrganization)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ORGANIZATION_ACCESS_DENIED' },
      });
      expect(model.findOne).toHaveBeenCalledTimes(1);
    },
  );
});
