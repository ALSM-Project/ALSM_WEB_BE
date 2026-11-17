import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  MeetingRequest,
  MeetingRequestDocument,
} from '../infrastructure/meeting-request.schema';
import {
  CONSULTATION_TYPES_CATALOG,
  ConsultationType,
  CustomerType,
  MeetingFormat,
  MeetingPriority,
  MeetingRequestStatus,
} from '../domain/meeting-request.types';
import {
  AssignSalesDto,
  CancelMeetingDto,
  ConfirmMeetingDto,
  CreateEnterpriseQuoteFromMeetingDto,
  CreateMeetingRequestDto,
  ListMeetingRequestsQueryDto,
  ProposeMeetingSlotsDto,
  RecordOutcomeDto,
  RescheduleMeetingDto,
} from '../presentation/meeting-request.dto';
import { GoogleCalendarService } from '../../../shared/google/google-calendar.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { Lead } from '../../crm/infrastructure/lead.schema';
import { User } from '../../users/infrastructure/user.schema';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class MeetingRequestService {
  private readonly logger = new Logger(MeetingRequestService.name);

  constructor(
    @InjectModel(MeetingRequest.name)
    private readonly meetingRequestModel: Model<MeetingRequestDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly googleCalendar: GoogleCalendarService,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
    @Optional()
    private readonly notificationsService?: NotificationsService,
  ) {}

  /**
   * Generates a readable unique Request ID, e.g. MTR-2026-0001
   */
  private async generateRequestId(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.meetingRequestModel.countDocuments();
    const sequence = String(count + 1).padStart(4, '0');
    return `MTR-${year}-${sequence}`;
  }

  /**
   * List consultation meeting requests with enterprise filtering, pagination, and sorting
   */
  async listMeetingRequests(
    query: ListMeetingRequestsQueryDto,
    caller?: { userId?: string; email?: string; isInternal?: boolean; organizationId?: string },
  ) {
    const filter: FilterQuery<MeetingRequestDocument> = {};

    const orgId = query.organizationId || caller?.organizationId;
    if (orgId && Types.ObjectId.isValid(orgId)) {
      filter['customer.organizationId'] = new Types.ObjectId(orgId);
    }

    if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
      filter['requirements.projectId'] = new Types.ObjectId(query.projectId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.consultationType) {
      filter.consultationType = query.consultationType;
    }

    if (query.priority) {
      filter.priority = query.priority;
    }

    if (query.assignedSalesId && Types.ObjectId.isValid(query.assignedSalesId)) {
      filter['assignment.assignedSalesId'] = new Types.ObjectId(query.assignedSalesId);
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    if (query.search?.trim()) {
      const searchRegex = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { requestId: searchRegex },
        { topic: searchRegex },
        { 'customer.fullName': searchRegex },
        { 'customer.companyName': searchRegex },
        { 'customer.email': searchRegex },
        { 'customer.phone': searchRegex },
      ];
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const skip = (page - 1) * limit;

    const sortField = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: sortDirection };

    const [items, total] = await Promise.all([
      this.meetingRequestModel.find(filter).sort(sort).skip(skip).limit(limit).exec(),
      this.meetingRequestModel.countDocuments(filter).exec(),
    ]);

    // Aggregate status counts for UI tabs
    const statusCountsRaw = await this.meetingRequestModel.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const statusCounts: Record<string, number> = {};
    for (const item of statusCountsRaw) {
      statusCounts[item._id] = item.count;
    }

    const isCustomer = caller && caller.isInternal === false;
    const sanitizedItems = isCustomer
      ? items.map((item) => {
          const obj = item.toObject();
          delete (obj as any).internalNotes;
          return obj as MeetingRequestDocument;
        })
      : items;

    return {
      items: sanitizedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      statusCounts,
      calendarIntegration: this.googleCalendar.getStatus(),
    };
  }

  /**
   * Create a new consultation request
   */
  async createMeetingRequest(
    dto: CreateMeetingRequestDto,
    actor?: { userId?: string; email?: string; organizationId?: string },
  ): Promise<MeetingRequestDocument> {
    const requestId = await this.generateRequestId();

    const orgId = dto.organizationId || actor?.organizationId;

    const newRequest = new this.meetingRequestModel({
      requestId,
      customer: {
        fullName: dto.fullName.trim(),
        companyName: dto.companyName.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim(),
        customerType: dto.customerType || CustomerType.PROSPECT,
        userId: actor?.userId && Types.ObjectId.isValid(actor.userId) ? new Types.ObjectId(actor.userId) : undefined,
        organizationId: orgId && Types.ObjectId.isValid(orgId) ? new Types.ObjectId(orgId) : undefined,
      },
      topic: dto.topic.trim(),
      consultationType: dto.consultationType || ConsultationType.SALES_SERVICE,
      priority: dto.priority || MeetingPriority.MEDIUM,
      status: MeetingRequestStatus.NEW_REQUEST,
      requirements: {
        serviceMode: dto.serviceMode || 'ALSM_MANAGED',
        legacySystemType: dto.legacySystemType?.trim() || 'IBM 3270 BMS',
        currentTechnology: dto.currentTechnology?.trim(),
        estimatedScreens: dto.estimatedScreens || 0,
        estimatedPrograms: dto.estimatedPrograms || 0,
        estimatedProjectScale: dto.estimatedProjectScale || 'MEDIUM',
        businessRequirements: dto.businessRequirements?.trim(),
        technicalRequirements: dto.technicalRequirements?.trim(),
        expectedTimeline: dto.expectedTimeline?.trim(),
        projectId: dto.projectId && Types.ObjectId.isValid(dto.projectId) ? new Types.ObjectId(dto.projectId) : undefined,
        projectName: dto.projectName?.trim(),
      },
      scheduling: {
        requestedDate: dto.requestedDate,
        requestedTime: dto.requestedTime,
        timezone: dto.timezone || 'Asia/Ho_Chi_Minh',
        durationMinutes: dto.durationMinutes || 45,
        format: MeetingFormat.GOOGLE_MEET,
        calendarIntegrationStatus: this.googleCalendar.isEnabled ? 'CONNECTED' : 'UNCONFIGURED',
        attendeeEmails: dto.attendeeEmails || [dto.email],
      },
      internalNotes: dto.message
        ? [
            {
              id: randomUUID(),
              authorId: actor?.userId || 'system',
              authorName: actor?.email || 'Customer Request',
              content: dto.message.trim(),
              createdAt: new Date(),
            },
          ]
        : [],
      meetingHistory: [
        {
          action: 'REQUEST_SUBMITTED',
          performedBy: actor?.email || dto.email,
          timestamp: new Date(),
          details: `Consultation request submitted for topic: ${dto.topic}`,
        },
      ],
    });

    const saved = await newRequest.save();

    await this.audit.append({
      actorUserId: actor?.userId,
      action: 'MEETING_REQUEST_CREATED',
      resourceType: 'MEETING_REQUEST',
      resourceId: saved.id,
      metadata: {
        requestId: saved.requestId,
        customerEmail: saved.customer.email,
        companyName: saved.customer.companyName,
      },
    });

    if (this.notificationsService) {
      try {
        await this.notificationsService.createForEmails({
          recipientEmails: ['sales@alsm.io', 'lead@alsm.io', 'admin@alsm.io'],
          type: 'MEETING_REQUEST_SUBMITTED',
          title: `New Consultation Request: ${saved.topic}`,
          message: `${saved.customer.fullName} (${saved.customer.companyName}) submitted a meeting request for ${saved.topic}`,
          eventKey: `meeting_request_created_${saved.requestId}`,
          resourceType: 'MEETING_REQUEST',
          resourceId: saved.id,
          link: `/meetings`,
        });
      } catch (err) {
        this.logger.warn(`Failed to dispatch notification: ${(err as Error).message}`);
      }
    }

    return saved;
  }

  /**
   * Get single meeting request by ID or Request ID
   */
  async getMeetingRequest(
    id: string,
    caller?: { userId?: string; email?: string; isInternal?: boolean },
  ): Promise<MeetingRequestDocument> {
    let query: FilterQuery<MeetingRequestDocument>;
    if (Types.ObjectId.isValid(id)) {
      query = { $or: [{ _id: new Types.ObjectId(id) }, { requestId: id }] };
    } else {
      query = { requestId: id };
    }

    const doc = await this.meetingRequestModel.findOne(query).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'MEETING_REQUEST_NOT_FOUND',
        message: `Meeting request '${id}' not found`,
      });
    }

    if (caller && caller.isInternal === false) {
      doc.internalNotes = [];
    }

    return doc;
  }

  /**
   * Assign Sales Representative to consultation
   */
  async assignSales(
    id: string,
    dto: AssignSalesDto,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);

    meeting.assignment = {
      assignedSalesId: new Types.ObjectId(dto.salesUserId),
      assignedSalesName: dto.salesName || 'Sales Representative',
      assignedSalesEmail: dto.salesEmail,
      assignedAt: new Date(),
      assignedBy: new Types.ObjectId(actor.userId),
    };

    if (meeting.status === MeetingRequestStatus.NEW_REQUEST) {
      meeting.status = MeetingRequestStatus.PENDING_SCHEDULING;
    }

    meeting.meetingHistory.push({
      action: 'SALES_ASSIGNED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Assigned sales representative: ${dto.salesName || dto.salesUserId}${dto.note ? ` (${dto.note})` : ''}`,
    });

    if (dto.note) {
      meeting.internalNotes.push({
        id: randomUUID(),
        authorId: actor.userId,
        authorName: actor.email,
        content: `Sales assignment note: ${dto.note}`,
        createdAt: new Date(),
      });
    }

    const updated = await meeting.save();

    await this.audit.append({
      actorUserId: actor.userId,
      action: 'MEETING_SALES_ASSIGNED',
      resourceType: 'MEETING_REQUEST',
      resourceId: meeting.id,
      metadata: {
        assignedSalesId: dto.salesUserId,
        assignedSalesName: dto.salesName || '',
      },
    });

    return updated;
  }

  /**
   * Propose available meeting slots to customer
   */
  async proposeMeetingSlots(
    id: string,
    dto: ProposeMeetingSlotsDto,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);

    if (!dto.slots || dto.slots.length === 0) {
      throw new BadRequestException('At least one slot must be proposed');
    }

    const proposedSlots = dto.slots.map((s) => ({
      slotId: randomUUID(),
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
      proposedBy: actor.email,
      proposedAt: new Date(),
      status: 'PROPOSED' as const,
    }));

    meeting.scheduling.proposedSlots = proposedSlots;
    meeting.status = MeetingRequestStatus.PENDING_SCHEDULING;

    meeting.meetingHistory.push({
      action: 'SLOTS_PROPOSED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Proposed ${proposedSlots.length} available meeting slots`,
    });

    meeting.communicationHistory.push({
      id: randomUUID(),
      channel: 'EMAIL',
      sender: actor.email,
      recipient: meeting.customer.email,
      subject: `ALSM Consultation Scheduling: ${meeting.topic}`,
      content: dto.message || `We have proposed ${proposedSlots.length} available consultation time slots for your review.`,
      sentAt: new Date(),
    });

    const updated = await meeting.save();
    return updated;
  }

  /**
   * Confirm meeting schedule and generate Google Meet or conference link
   */
  async confirmMeeting(
    id: string,
    dto: ConfirmMeetingDto,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);

    const start = new Date(dto.scheduledStartTime);
    const end = new Date(dto.scheduledEndTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid scheduled start or end time format');
    }
    if (end <= start) {
      throw new BadRequestException('End time must be after start time');
    }

    meeting.scheduling.scheduledStartTime = start;
    meeting.scheduling.scheduledEndTime = end;
    meeting.scheduling.durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    meeting.scheduling.format = dto.format || MeetingFormat.GOOGLE_MEET;

    // Google Meet handling
    if (dto.customMeetingUrl?.trim()) {
      meeting.scheduling.meetingUrl = dto.customMeetingUrl.trim();
      const match = dto.customMeetingUrl.match(/https:\/\/meet\.google\.com\/([a-z0-9-]+)/);
      meeting.scheduling.meetingCode = match ? match[1] : undefined;
      meeting.scheduling.calendarIntegrationStatus = 'MANUAL';
    } else if (dto.createGoogleMeet !== false && this.googleCalendar.isEnabled) {
      try {
        const attendeeEmails = [meeting.customer.email];
        if (meeting.assignment.assignedSalesEmail) {
          attendeeEmails.push(meeting.assignment.assignedSalesEmail);
        }
        const gcal = await this.googleCalendar.createMeetingEvent({
          title: `ALSM Consultation: ${meeting.topic} (${meeting.customer.companyName})`,
          description: `Customer: ${meeting.customer.fullName} (${meeting.customer.companyName})\nConsultation Type: ${meeting.consultationType}\nTopic: ${meeting.topic}`,
          attendeeEmails,
          hostEmail: actor.email,
          scheduledStartTime: start,
          scheduledEndTime: end,
        });
        meeting.scheduling.meetingUrl = gcal.meetingUrl;
        meeting.scheduling.meetingCode = gcal.meetingCode;
        meeting.scheduling.calendarEventId = gcal.calendarEventId;
        meeting.scheduling.calendarIntegrationStatus = 'CONNECTED';
      } catch (err) {
        this.logger.error(`Google Calendar Meet creation failed: ${(err as Error).message}`);
        meeting.scheduling.calendarIntegrationStatus = 'FAILED';
      }
    } else {
      meeting.scheduling.calendarIntegrationStatus = 'UNCONFIGURED';
    }

    meeting.status = MeetingRequestStatus.CONFIRMED;

    meeting.meetingHistory.push({
      action: 'MEETING_CONFIRMED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Meeting confirmed for ${start.toISOString()} - ${end.toISOString()} (${meeting.scheduling.format})${meeting.scheduling.meetingUrl ? ` URL: ${meeting.scheduling.meetingUrl}` : ''}`,
    });

    meeting.communicationHistory.push({
      id: randomUUID(),
      channel: 'EMAIL',
      sender: actor.email,
      recipient: meeting.customer.email,
      subject: `Confirmed: ALSM Consultation on ${start.toLocaleDateString()}`,
      content: `Your ALSM consultation meeting is confirmed for ${start.toUTCString()}.\nMeeting Link: ${meeting.scheduling.meetingUrl || 'Link will be provided prior to call.'}`,
      sentAt: new Date(),
    });

    const updated = await meeting.save();

    await this.audit.append({
      actorUserId: actor.userId,
      action: 'MEETING_CONFIRMED',
      resourceType: 'MEETING_REQUEST',
      resourceId: meeting.id,
      metadata: {
        scheduledStartTime: start.toISOString(),
        meetingUrl: meeting.scheduling.meetingUrl || '',
      },
    });

    return updated;
  }

  /**
   * Reschedule confirmed meeting
   */
  async rescheduleMeeting(
    id: string,
    dto: RescheduleMeetingDto,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);

    const start = new Date(dto.scheduledStartTime);
    const end = new Date(dto.scheduledEndTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('Invalid rescheduled start or end time');
    }

    // If Google Calendar event exists, update it
    if (meeting.scheduling.calendarEventId && this.googleCalendar.isEnabled) {
      try {
        await this.googleCalendar.updateMeetingEvent({
          calendarEventId: meeting.scheduling.calendarEventId,
          scheduledStartTime: start,
          scheduledEndTime: end,
          description: `Rescheduled by ${actor.email}. Reason: ${dto.reason}`,
        });
      } catch (err) {
        this.logger.warn(`Failed to update Google Calendar event: ${(err as Error).message}`);
      }
    }

    meeting.scheduling.scheduledStartTime = start;
    meeting.scheduling.scheduledEndTime = end;
    meeting.status = MeetingRequestStatus.RESCHEDULE_REQUESTED;

    meeting.meetingHistory.push({
      action: 'MEETING_RESCHEDULED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Rescheduled to ${start.toISOString()}. Reason: ${dto.reason}`,
    });

    meeting.internalNotes.push({
      id: randomUUID(),
      authorId: actor.userId,
      authorName: actor.email,
      content: `Meeting rescheduled: ${dto.reason}`,
      createdAt: new Date(),
    });

    return meeting.save();
  }

  /**
   * Cancel meeting
   */
  async cancelMeeting(
    id: string,
    dto: CancelMeetingDto,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);

    if (meeting.scheduling.calendarEventId && this.googleCalendar.isEnabled) {
      try {
        await this.googleCalendar.deleteMeetingEvent(meeting.scheduling.calendarEventId);
      } catch (err) {
        this.logger.warn(`Failed to delete Google Calendar event: ${(err as Error).message}`);
      }
    }

    meeting.status = MeetingRequestStatus.CANCELLED;
    meeting.statusReason = dto.reason;

    meeting.meetingHistory.push({
      action: 'MEETING_CANCELLED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Cancelled: ${dto.reason}`,
    });

    meeting.internalNotes.push({
      id: randomUUID(),
      authorId: actor.userId,
      authorName: actor.email,
      content: `Cancellation reason: ${dto.reason}`,
      createdAt: new Date(),
    });

    return meeting.save();
  }

  /**
   * Record outcome after consultation is conducted
   */
  async recordOutcome(
    id: string,
    dto: RecordOutcomeDto,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);

    meeting.outcome = {
      summary: dto.summary,
      qualificationScore: dto.qualificationScore,
      nextSteps: dto.nextSteps,
      recordedBy: actor.email,
      recordedAt: new Date(),
    };

    meeting.status = MeetingRequestStatus.COMPLETED;

    meeting.meetingHistory.push({
      action: 'OUTCOME_RECORDED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Recorded outcome. Qualification Score: ${dto.qualificationScore ?? 'N/A'}/100`,
    });

    return meeting.save();
  }

  /**
   * Convert consultation into a CRM Lead / Sales Opportunity
   */
  async convertToOpportunity(
    id: string,
    dto: { title?: string; estimatedValue?: number; notes?: string },
    actor: { userId: string; email: string },
  ): Promise<{ meeting: MeetingRequestDocument; leadId: string }> {
    const meeting = await this.getMeetingRequest(id);

    const title = dto.title?.trim() || `${meeting.customer.companyName} - Modernization Project`;
    const lead = new this.leadModel({
      title,
      company: meeting.customer.companyName,
      companyName: meeting.customer.companyName,
      contactName: meeting.customer.fullName,
      contactEmail: meeting.customer.email,
      phone: meeting.customer.phone,
      source: 'Meeting & Consultation Request',
      sourceReference: meeting.requestId,
      creationFingerprint: `lead-${meeting.requestId}-${Date.now()}`,
      revision: 1,
      stage: 'QUALIFIED',
      score: meeting.outcome?.qualificationScore || 75,
      dealValue: dto.estimatedValue || 200000000,
      currency: 'VND',
      assignedToUserId: meeting.assignment.assignedSalesId || new Types.ObjectId(actor.userId),
      assignedToName: meeting.assignment.assignedSalesName || actor.email,
      assignments: [
        {
          assignedToUserId: meeting.assignment.assignedSalesId || new Types.ObjectId(actor.userId),
          assignedAt: new Date(),
          assignedByUserId: new Types.ObjectId(actor.userId),
        },
      ],
      notes: `${dto.notes ? `${dto.notes}\n\n` : ''}Requirements:\nLegacy System: ${meeting.requirements.legacySystemType}\nEstimated Screens: ${meeting.requirements.estimatedScreens}\nTimeline: ${meeting.requirements.expectedTimeline || 'TBD'}\nOutcome: ${meeting.outcome?.summary || 'Qualified during consultation.'}`,
      organizationId: meeting.customer.organizationId || new Types.ObjectId(actor.userId),
      status: 'QUALIFIED',
    });

    const savedLead = await lead.save();

    meeting.relatedLeadId = savedLead._id as Types.ObjectId;
    meeting.relatedOpportunityId = savedLead.id;

    meeting.meetingHistory.push({
      action: 'CONVERTED_TO_OPPORTUNITY',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Converted to Sales Opportunity '${title}' (Lead ID: ${savedLead.id})`,
    });

    const updated = await meeting.save();

    await this.audit.append({
      actorUserId: actor.userId,
      action: 'MEETING_CONVERTED_TO_LEAD',
      resourceType: 'MEETING_REQUEST',
      resourceId: meeting.id,
      metadata: { leadId: savedLead.id, companyName: meeting.customer.companyName },
    });

    return { meeting: updated, leadId: savedLead.id };
  }

  /**
   * Create an enterprise quote directly from consultation and opportunity
   */
  async createEnterpriseQuote(
    id: string,
    dto: CreateEnterpriseQuoteFromMeetingDto,
    actor: { userId: string; email: string },
  ): Promise<{ meeting: MeetingRequestDocument; quoteId: string; quoteNumber: string }> {
    const meeting = await this.getMeetingRequest(id);

    // If no lead exists, convert first
    let leadDoc: any;
    if (meeting.relatedLeadId) {
      leadDoc = await this.leadModel.findById(meeting.relatedLeadId).exec();
    }

    if (!leadDoc) {
      const conv = await this.convertToOpportunity(id, { title: `${meeting.customer.companyName} Modernization Quote` }, actor);
      leadDoc = await this.leadModel.findById(conv.leadId).exec();
    }

    const discount = dto.discountPercent || 0;
    const finalPrice = Math.round(dto.amount * (1 - discount / 100));
    const quoteId = `qte-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const quoteNumber = `QTE-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const quoteEntry = {
      id: quoteId,
      quoteNumber,
      planName: dto.planName,
      projectScope: dto.projectScope || `${meeting.requirements.estimatedScreens} screens modernization`,
      amount: dto.amount,
      discountPercent: discount,
      discountReason: dto.discountReason,
      finalPrice,
      status: 'DRAFT',
      approvalStatus: discount >= 15 ? 'REQUIRES_HIGHER_APPROVAL' : 'APPROVED',
      salesOwner: actor.email,
      createdAt: new Date(),
    };

    if (!leadDoc.quotes) leadDoc.quotes = [];
    leadDoc.quotes.push(quoteEntry);
    await leadDoc.save();

    meeting.relatedQuoteId = quoteNumber;
    meeting.meetingHistory.push({
      action: 'QUOTE_GENERATED',
      performedBy: actor.email,
      timestamp: new Date(),
      details: `Generated quote ${quoteNumber} (${dto.planName}): ${finalPrice.toLocaleString()} VND`,
    });

    const updated = await meeting.save();
    return { meeting: updated, quoteId, quoteNumber };
  }

  /**
   * Add internal note
   */
  async addInternalNote(
    id: string,
    content: string,
    actor: { userId: string; email: string },
  ): Promise<MeetingRequestDocument> {
    const meeting = await this.getMeetingRequest(id);
    meeting.internalNotes.push({
      id: randomUUID(),
      authorId: actor.userId,
      authorName: actor.email,
      content: content.trim(),
      createdAt: new Date(),
    });
    return meeting.save();
  }

  /**
   * Returns list of configured consultation types
   */
  getConsultationTypes() {
    return CONSULTATION_TYPES_CATALOG;
  }

  /**
   * Returns calendar integration status
   */
  getCalendarStatus() {
    return this.googleCalendar.getStatus();
  }

  /**
   * Returns members strictly belonging to the caller organization
   */
  async getOrganizationMembers(actor: {
    userId?: string;
    email?: string;
    organizationId?: string;
  }) {
    let orgId = actor.organizationId;
    if (!orgId && actor.userId && Types.ObjectId.isValid(actor.userId)) {
      const userDoc = await this.userModel.findById(actor.userId).exec();
      orgId = (userDoc as any)?.organizationId?.toString();
    }
    if (!orgId && actor.email) {
      const userDoc = await this.userModel.findOne({ email: actor.email.toLowerCase().trim() }).exec();
      orgId = (userDoc as any)?.organizationId?.toString();
    }

    if (!orgId) {
      return [];
    }

    const orgObjId = Types.ObjectId.isValid(orgId) ? new Types.ObjectId(orgId) : null;
    const filterConditions: any[] = [{ organizationId: orgId }];
    if (orgObjId) {
      filterConditions.push({ organizationId: orgObjId });
    }

    const users = await this.userModel
      .find({ $or: filterConditions })
      .select('email fullName role roles isActive')
      .exec();

    return users.map((u) => ({
      id: u.id || (u as any)._id?.toString(),
      name: u.fullName || u.email.split('@')[0],
      email: u.email,
      role: Array.isArray(u.roles) && u.roles.length > 0 ? u.roles[0] : (u.role || 'Member'),
      status: u.isActive !== false ? 'Active' : 'Inactive',
    }));
  }
}
