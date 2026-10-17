import { Model, Types } from 'mongoose';
import { MongoProjectRepository } from '../src/modules/projects/infrastructure/mongo-project.repository';
import { Project } from '../src/modules/projects/infrastructure/project.schema';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';
import { toValidObjectId } from '../src/shared/utils/object-id.util';

describe('MongoProjectRepository tenant isolation', () => {
  const organizationA = new Types.ObjectId().toHexString();
  const organizationB = new Types.ObjectId().toHexString();
  const projectId = new Types.ObjectId().toHexString();
  const document = {
    id: projectId,
    organizationId: new Types.ObjectId(organizationB),
    name: 'project-b',
    conversionType: ConversionType.COBOL_TO_JAVA,
    status: ProjectStatus.DRAFT,
    createdBy: new Types.ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const exec = jest.fn();
  const model = { findOne: jest.fn(() => ({ exec })), create: jest.fn() };
  const repository = new MongoProjectRepository(model as unknown as Model<Project>);
  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockReset();
  });

  it.each([projectId, 'project-b'])(
    'cannot read B through A using %s or retry unscoped',
    async (id) => {
      exec.mockResolvedValueOnce(null).mockResolvedValue(document);
      await expect(repository.findById(id, organizationA)).resolves.toBeNull();
      expect(model.findOne).toHaveBeenCalledTimes(1);
      expect(model.findOne).toHaveBeenCalledWith({
        $or: [{ _id: toValidObjectId(id) }, { name: id }],
        organizationId: { $in: [new Types.ObjectId(organizationA), organizationA] },
        deletedAt: { $exists: false },
      });
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it.each(['', '   ', undefined, null])(
    'fails closed for organization %s without querying',
    async (organizationId) => {
      await expect(
        repository.findById(projectId, organizationId as unknown as string),
      ).resolves.toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it.each([projectId, 'project-b'])(
    'returns a scoped project by ID or name/slug: %s',
    async (id) => {
      exec.mockResolvedValue(document);
      await expect(repository.findById(id, organizationB)).resolves.toMatchObject({
        id: projectId,
        organizationId: organizationB,
        name: 'project-b',
      });
      expect(model.findOne).toHaveBeenCalledTimes(1);
      expect(model.findOne).toHaveBeenCalledWith({
        $or: [{ _id: toValidObjectId(id) }, { name: id }],
        organizationId: { $in: [new Types.ObjectId(organizationB), organizationB] },
        deletedAt: { $exists: false },
      });
    },
  );
});
