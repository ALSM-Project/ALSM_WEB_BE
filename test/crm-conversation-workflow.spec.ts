import { Types } from 'mongoose';
import { CrmConversationService } from '../src/modules/crm/application/crm-conversation.service';
import { ConversationStatus, ConversationChannel } from '../src/modules/crm/infrastructure/crm-conversation.schema';

describe('CrmConversationService - Convert to Lead and CRM Workflow', () => {
  let service: CrmConversationService;
  let mockConversationModel: any;
  let mockMessageModel: any;
  let mockLeadModel: any;
  let mockWsService: any;

  beforeEach(() => {
    mockConversationModel = {
      findById: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };

    mockMessageModel = {
      create: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
    };

    mockLeadModel = {
      findById: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
    };

    mockWsService = {
      broadcastConversationUpdated: jest.fn(),
      broadcastMessageToRoom: jest.fn(),
    };

    service = new CrmConversationService(
      mockConversationModel,
      mockMessageModel,
      mockLeadModel,
      mockWsService,
    );
  });

  it('should successfully convert conversation to a new CRM Lead', async () => {
    const convId = new Types.ObjectId().toString();
    const mockConv: any = {
      _id: new Types.ObjectId(convId),
      title: 'Need 50 Screens Migration',
      customerName: 'Hoang Nguyen',
      customerEmail: 'hoang@example.com',
      customerPhone: '0987654321',
      companyName: 'TechCorp Vietnam',
      channel: ConversationChannel.PORTAL,
      status: ConversationStatus.OPEN,
      lastMessage: 'Can you provide quote for 50 screens?',
      save: jest.fn().mockResolvedValue(true),
    };

    mockConversationModel.findById.mockResolvedValue(mockConv);

    const createdLeadId = new Types.ObjectId();
    const createdLeadDoc: any = {
      _id: createdLeadId,
      title: 'TechCorp Vietnam - Modernization Deal',
      stage: 'NEW',
      dealValue: 150000000,
      contactEmail: 'hoang@example.com',
      contactName: 'Hoang Nguyen',
      company: 'TechCorp Vietnam',
      conversationId: mockConv._id,
    };

    mockLeadModel.create.mockResolvedValue(createdLeadDoc);

    const result = await service.convertToLead(
      'user-123',
      'sales@alsm.io',
      'Alex Sales',
      convId,
      {
        companyName: 'TechCorp Vietnam',
        businessRequirements: 'Migrate 50 Oracle Forms to Next.js',
        estimatedScreens: 50,
        estimatedPrograms: 10,
        estimatedValue: 150000000,
        priority: 'HIGH',
        notes: 'Client has budget approved for Q4',
      },
    );

    expect(result.success).toBe(true);
    expect(result.leadId).toBe(createdLeadId.toString());
    expect(result.isExistingLinked).toBe(false);
    expect(mockConv.leadId).toEqual(createdLeadId);
    expect(mockConv.status).toBe(ConversationStatus.IN_PROGRESS);
    expect(mockConv.save).toHaveBeenCalled();
    expect(mockWsService.broadcastConversationUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: convId,
        leadId: createdLeadId.toString(),
      }),
    );
  });

  it('should prevent converting the same conversation more than once', async () => {
    const convId = new Types.ObjectId().toString();
    const existingLeadId = new Types.ObjectId();
    const mockConv: any = {
      _id: new Types.ObjectId(convId),
      title: 'Already Converted',
      leadId: existingLeadId,
      customerEmail: 'test@example.com',
    };

    mockConversationModel.findById.mockResolvedValue(mockConv);

    await expect(
      service.convertToLead('user-123', 'sales@alsm.io', 'Alex', convId, {}),
    ).rejects.toThrow('already linked');
  });

  it('should support linking conversation to an existing Lead when requested', async () => {
    const convId = new Types.ObjectId().toString();
    const existingLeadId = new Types.ObjectId().toString();

    const mockConv: any = {
      _id: new Types.ObjectId(convId),
      title: 'Follow-up question',
      customerName: 'Hoang Nguyen',
      customerEmail: 'hoang@example.com',
      status: ConversationStatus.OPEN,
      save: jest.fn().mockResolvedValue(true),
    };

    const mockExistingLead: any = {
      _id: new Types.ObjectId(existingLeadId),
      title: 'TechCorp Enterprise',
      stage: 'QUALIFIED',
      dealValue: 200000000,
      contactEmail: 'hoang@example.com',
      contactName: 'Hoang Nguyen',
      company: 'TechCorp',
      interactions: [],
      save: jest.fn().mockResolvedValue(true),
    };

    mockConversationModel.findById.mockResolvedValue(mockConv);
    mockLeadModel.findById.mockResolvedValue(mockExistingLead);

    const result = await service.convertToLead(
      'user-123',
      'sales@alsm.io',
      'Alex',
      convId,
      {
        existingLeadId,
        notes: 'Customer inquiring about maintenance terms for existing deal',
      },
    );

    expect(result.success).toBe(true);
    expect(result.leadId).toBe(existingLeadId);
    expect(result.isExistingLinked).toBe(true);
    expect(mockConv.leadId).toEqual(mockExistingLead._id);
    expect(mockExistingLead.interactions.length).toBe(1);
    expect(mockExistingLead.save).toHaveBeenCalled();
  });
});
