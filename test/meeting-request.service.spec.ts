import { Model, Types } from 'mongoose';
import { MeetingRequestService } from '../src/modules/meetings/application/meeting-request.service';
import { MeetingRequest, MeetingRequestDocument } from '../src/modules/meetings/infrastructure/meeting-request.schema';
import { Lead } from '../src/modules/crm/infrastructure/lead.schema';
import { User } from '../src/modules/users/infrastructure/user.schema';
import { GoogleCalendarService } from '../src/shared/google/google-calendar.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ConsultationType, MeetingPriority, MeetingRequestStatus } from '../src/modules/meetings/domain/meeting-request.types';

describe('MeetingRequestService (Consultation Management)', () => {
  let service: MeetingRequestService;

  const mockMeetingDoc: any = {
    _id: new Types.ObjectId(),
    id: 'mock-req-id',
    requestId: 'MTR-2026-0001',
    customer: {
      fullName: 'Alice Nguyen',
      companyName: 'Acme Bank',
      email: 'alice@acme.example',
      phone: '+84901234567',
    },
    topic: 'Core Banking BMS to React 19',
    consultationType: ConsultationType.SALES_SERVICE,
    priority: MeetingPriority.HIGH,
    status: MeetingRequestStatus.NEW_REQUEST,
    requirements: {
      serviceMode: 'ALSM_MANAGED',
      legacySystemType: 'IBM 3270 BMS',
      estimatedScreens: 120,
    },
    scheduling: {
      timezone: 'Asia/Ho_Chi_Minh',
      durationMinutes: 45,
      calendarIntegrationStatus: 'UNCONFIGURED',
      proposedSlots: [],
    },
    assignment: {},
    internalNotes: [],
    communicationHistory: [],
    meetingHistory: [],
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
  };

  const meetingRequestModel = {
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([mockMeetingDoc]),
    }),
    findOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockMeetingDoc),
    }),
    aggregate: jest.fn().mockResolvedValue([{ _id: 'NEW_REQUEST', count: 1 }]),
  } as unknown as Model<MeetingRequestDocument>;

  const mockLeadDoc: any = {
    _id: new Types.ObjectId(),
    id: 'lead-123',
    company: 'Acme Bank',
    quotes: [],
    save: jest.fn().mockResolvedValue(true),
  };

  const leadModel = {
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockLeadDoc),
    }),
  } as unknown as Model<Lead>;

  const userModel = {} as unknown as Model<User>;

  const googleCalendar = {
    isEnabled: false,
    getStatus: jest.fn().mockReturnValue({ isEnabled: false }),
    createMeetingEvent: jest.fn().mockResolvedValue({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      meetingCode: 'abc-defg-hij',
      calendarEventId: 'event-123',
    }),
    updateMeetingEvent: jest.fn().mockResolvedValue({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      meetingCode: 'abc-defg-hij',
      calendarEventId: 'event-123',
    }),
    deleteMeetingEvent: jest.fn().mockResolvedValue(undefined),
  } as unknown as GoogleCalendarService;

  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockModelFn: any = jest.fn().mockImplementation((data) => ({
      ...data,
      id: 'mock-req-id',
      save: jest.fn().mockResolvedValue({ ...data, id: 'mock-req-id' }),
    }));
    Object.assign(mockModelFn, meetingRequestModel);

    const mockLeadModelFn: any = jest.fn().mockImplementation((data) => ({
      ...data,
      id: 'lead-123',
      _id: new Types.ObjectId(),
      save: jest.fn().mockResolvedValue({ ...data, id: 'lead-123', _id: new Types.ObjectId() }),
    }));
    Object.assign(mockLeadModelFn, leadModel);

    service = new MeetingRequestService(
      mockModelFn,
      mockLeadModelFn,
      userModel,
      googleCalendar,
      audit,
    );
  });

  it('lists meeting requests with pagination and status counts', async () => {
    const res = await service.listMeetingRequests({ page: 1, limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.statusCounts).toHaveProperty('NEW_REQUEST');
  });

  it('assigns a sales rep and transitions status from NEW_REQUEST to PENDING_SCHEDULING', async () => {
    mockMeetingDoc.status = MeetingRequestStatus.NEW_REQUEST;
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const salesUserId = new Types.ObjectId().toString();

    const updated = await service.assignSales(
      'mock-req-id',
      { salesUserId, salesName: 'Bob Sales', salesEmail: 'bob@alsm.dev' },
      actor,
    );

    expect(updated.status).toBe(MeetingRequestStatus.PENDING_SCHEDULING);
    expect(updated.assignment.assignedSalesName).toBe('Bob Sales');
    expect(audit.append).toHaveBeenCalled();
  });

  it('proposes meeting slots and adds a communication entry', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const updated = await service.proposeMeetingSlots(
      'mock-req-id',
      {
        slots: [
          { startTime: '2026-11-20T09:00:00Z', endTime: '2026-11-20T09:45:00Z' },
        ],
      },
      actor,
    );

    expect(updated.scheduling.proposedSlots).toHaveLength(1);
    expect(updated.communicationHistory.length).toBeGreaterThan(0);
  });

  it('confirms a meeting and updates calendarIntegrationStatus when Google Calendar is unconfigured', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();

    const updated = await service.confirmMeeting(
      'mock-req-id',
      {
        scheduledStartTime: start,
        scheduledEndTime: end,
        createGoogleMeet: true,
      },
      actor,
    );

    expect(updated.status).toBe(MeetingRequestStatus.CONFIRMED);
    expect(updated.scheduling.calendarIntegrationStatus).toBe('UNCONFIGURED');
  });

  it('records outcome and completes the consultation', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const updated = await service.recordOutcome(
      'mock-req-id',
      {
        summary: 'Customer has 120 BMS maps, ready for PoC',
        qualificationScore: 92,
        nextSteps: 'Send contract draft and schedule PoC kickoff',
      },
      actor,
    );

    expect(updated.status).toBe(MeetingRequestStatus.COMPLETED);
    expect(updated.outcome?.qualificationScore).toBe(92);
  });

  it('converts meeting into a Sales Opportunity lead', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const result = await service.convertToOpportunity(
      'mock-req-id',
      { title: 'Acme Bank Modernization Deal', estimatedValue: 350000000 },
      actor,
    );

    expect(result.leadId).toBeDefined();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEETING_CONVERTED_TO_LEAD' }),
    );
  });

  it('creates an enterprise quote attached to the opportunity', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const res = await service.createEnterpriseQuote(
      'mock-req-id',
      {
        planName: 'Enterprise Managed Modernization',
        amount: 300000000,
        discountPercent: 10,
        projectScope: '120 screens BMS to React 19',
      },
      actor,
    );

    expect(res.quoteNumber).toMatch(/^QTE-2026-/);
  });
});
