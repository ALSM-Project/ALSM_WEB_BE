import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { randomUUID, randomBytes } from 'node:crypto';
import { Lead, LeadDocument } from '../infrastructure/lead.schema';
import { LeadStatus } from '../domain/lead.types';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CrmConversation,
  CrmConversationDocument,
  ConversationStatus,
  ConversationChannel,
} from '../infrastructure/crm-conversation.schema';
import {
  CrmConversationMessage,
  CrmConversationMessageDocument,
  MessageSenderRole,
} from '../infrastructure/crm-conversation-message.schema';
import {
  CreateConversationDto,
  PostMessageDto,
  CrmConversationItem,
  CrmConversationMessageItem,
  ConvertToLeadDto,
  ConvertToLeadResult,
  CheckLeadStatusResult,
} from '../presentation/crm-conversation.dto';
import { CrmChatWebSocketService } from '../infrastructure/crm-chat.websocket';

@Injectable()
export class CrmConversationService {
  private readonly logger = new Logger(CrmConversationService.name);

  constructor(
    @InjectModel(CrmConversation.name)
    private readonly conversationModel: Model<CrmConversationDocument>,
    @InjectModel(CrmConversationMessage.name)
    private readonly messageModel: Model<CrmConversationMessageDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @Inject(forwardRef(() => CrmChatWebSocketService))
    private readonly wsService: CrmChatWebSocketService,
    @Optional()
    @InjectModel('Project')
    private readonly projectModel?: Model<any>,
  ) {}

  private mapConversationDoc(item: any): CrmConversationItem {
    return {
      id: item._id ? item._id.toString() : item.id,
      title: item.title,
      status: item.status,
      channel: item.channel,
      leadId: item.leadId?.toString(),
      organizationId: item.organizationId?.toString(),
      projectId: item.projectId?.toString(),
      projectName: item.projectName,
      conversionRequestId: item.conversionRequestId?.toString(),
      requestNumber: item.requestNumber,
      conversationType: item.conversationType || (item.projectId ? 'PROJECT' : 'GENERAL'),
      customerName: item.customerName,
      customerEmail: item.customerEmail,
      customerPhone: item.customerPhone,
      companyName: item.companyName,
      assignedToUserId: item.assignedToUserId?.toString(),
      assignedToEmail: item.assignedToEmail,
      assignedToName: item.assignedToName,
      participants: item.participants || [],
      lastMessage: item.lastMessage,
      lastMessageAt: item.lastMessageAt,
      unreadCount: item.unreadCount || 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async listConversations(
    query: {
      leadId?: string;
      organizationId?: string;
      projectId?: string;
      conversationType?: string;
      status?: string;
      search?: string;
      channel?: string;
      unreadOnly?: boolean;
    },
    actor?: { userId?: string; email?: string },
  ): Promise<CrmConversationItem[]> {
    // If organizationId is provided and projectModel is available, auto-sync project conversations
    if (query.organizationId && this.projectModel && Types.ObjectId.isValid(query.organizationId)) {
      try {
        const orgId = new Types.ObjectId(query.organizationId);
        const projects = await this.projectModel
          .find({
            organizationId: orgId,
            deletedAt: { $exists: false },
          })
          .lean();

        for (const proj of projects) {
          const existing = await this.conversationModel
            .findOne({
              projectId: proj._id,
              organizationId: orgId,
            })
            .lean();

          if (!existing) {
            const teamLead = proj.assignedTeamLeadName || 'Solutions Architect';
            const staff = proj.assignedStaffName || 'Modernization Engineer';
            const participants = [
              {
                email: actor?.email || 'customer@enterprise.com',
                name: actor?.email ? actor.email.split('@')[0] : 'Customer Representative',
                role: 'Client Member',
                type: 'CUSTOMER' as const,
              },
              {
                email: 'lead@alsm.io',
                name: teamLead,
                role: 'ALSM Team Lead',
                type: 'ALSM' as const,
              },
              {
                email: 'staff@alsm.io',
                name: staff,
                role: 'ALSM Engineer',
                type: 'ALSM' as const,
              },
            ];

            const conv = await this.conversationModel.create({
              title: `${proj.name} — Modernization Group`,
              status: ConversationStatus.OPEN,
              channel: ConversationChannel.PORTAL,
              organizationId: orgId,
              projectId: proj._id,
              projectName: proj.name,
              conversionRequestId: proj.conversionRequestId,
              conversationType: 'PROJECT',
              customerName: proj.name,
              customerEmail: actor?.email || 'customer@alsm.dev',
              companyName: 'Enterprise Client',
              assignedToName: teamLead,
              assignedToEmail: 'lead@alsm.io',
              participants,
              lastMessage: `Modernization group chat initialized for ${proj.name}.`,
              lastMessageAt: new Date(),
              unreadCount: 0,
            });

            await this.messageModel.create({
              conversationId: conv._id,
              senderName: 'ALSM Platform',
              senderEmail: 'system@alsm.io',
              senderRole: MessageSenderRole.SYSTEM,
              content: `Welcome to the ${proj.name} group chat. Your assigned ALSM modernization team is available here to coordinate technical reviews, architecture alignment, and progress updates.`,
              isInternal: false,
              createdAt: new Date(),
            });
          }
        }
      } catch (err) {
        this.logger.warn(`Project conversation auto-sync skipped: ${(err as Error).message}`);
      }
    }

    const filter: Record<string, any> = {};

    if (query.organizationId && Types.ObjectId.isValid(query.organizationId)) {
      filter.organizationId = new Types.ObjectId(query.organizationId);
    }

    if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
      filter.projectId = new Types.ObjectId(query.projectId);
    }

    if (query.conversationType && query.conversationType !== 'ALL') {
      filter.conversationType = query.conversationType;
    }

    if (query.leadId && Types.ObjectId.isValid(query.leadId)) {
      filter.leadId = new Types.ObjectId(query.leadId);
    }

    if (query.status && query.status !== 'ALL') {
      filter.status = query.status;
    }

    if (query.channel && query.channel !== 'ALL') {
      filter.channel = query.channel;
    }

    if (query.unreadOnly) {
      filter.unreadCount = { $gt: 0 };
    }

    if (query.search && query.search.trim()) {
      const regex = new RegExp(query.search.trim(), 'i');
      filter.$or = [
        { title: regex },
        { projectName: regex },
        { customerName: regex },
        { customerEmail: regex },
        { companyName: regex },
      ];
    }

    const items = await this.conversationModel
      .find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean();

    return items.map((item) => this.mapConversationDoc(item));
  }

  async getConversationById(id: string, requesterEmail?: string): Promise<CrmConversationItem> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid conversation ID: ${id}`);
    }

    const conversation = await this.conversationModel.findById(id).lean();
    if (!conversation) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    // Reset unread count when opened
    await this.conversationModel.updateOne({ _id: id }, { $set: { unreadCount: 0 } });

    return this.mapConversationDoc({ ...conversation, unreadCount: 0 });
  }

  async getOrCreateCustomerConversation(
    customerEmail: string,
    customerName: string,
    companyName?: string,
  ): Promise<CrmConversationItem> {
    const email = customerEmail.toLowerCase().trim();
    const existing = await this.conversationModel
      .findOne({ customerEmail: email })
      .sort({ createdAt: -1 })
      .lean();

    let convDoc: any = existing;

    if (!convDoc) {
      const created = await this.conversationModel.create({
        title: `Modernization Support & Inquiries - ${companyName || customerName}`,
        status: ConversationStatus.OPEN,
        channel: ConversationChannel.PORTAL,
        customerName: customerName || email.split('@')[0],
        customerEmail: email,
        companyName: companyName || 'Client Workspace',
        lastMessage: 'Conversation opened via Customer Portal (FE1)',
        lastMessageAt: new Date(),
        unreadCount: 0,
      });

      convDoc = created.toObject();

      this.wsService.broadcastConversationUpdated(this.mapConversationDoc(convDoc));
    }

    return this.mapConversationDoc(convDoc);
  }

  async createConversation(
    userId: string,
    userEmail: string,
    userName: string,
    dto: CreateConversationDto,
  ): Promise<CrmConversationItem> {
    // If projectId is provided, check if one already exists to avoid duplicate conversations
    if (dto.projectId && Types.ObjectId.isValid(dto.projectId)) {
      const existing = await this.conversationModel
        .findOne({
          projectId: new Types.ObjectId(dto.projectId),
        })
        .lean();
      if (existing) {
        return this.mapConversationDoc(existing);
      }
    }

    const newDoc = new this.conversationModel({
      title: dto.title,
      status: ConversationStatus.OPEN,
      channel: dto.channel || ConversationChannel.PORTAL,
      leadId: dto.leadId && Types.ObjectId.isValid(dto.leadId) ? new Types.ObjectId(dto.leadId) : undefined,
      organizationId: dto.organizationId && Types.ObjectId.isValid(dto.organizationId) ? new Types.ObjectId(dto.organizationId) : undefined,
      projectId: dto.projectId && Types.ObjectId.isValid(dto.projectId) ? new Types.ObjectId(dto.projectId) : undefined,
      projectName: dto.projectName,
      conversionRequestId: dto.conversionRequestId && Types.ObjectId.isValid(dto.conversionRequestId) ? new Types.ObjectId(dto.conversionRequestId) : undefined,
      requestNumber: dto.requestNumber,
      conversationType: dto.conversationType || (dto.projectId ? 'PROJECT' : 'GENERAL'),
      participants: dto.participants || [
        {
          email: userEmail,
          name: userName,
          role: 'Requester',
          type: 'CUSTOMER',
        },
      ],
      customerName: dto.customerName,
      customerEmail: dto.customerEmail.toLowerCase(),
      customerPhone: dto.customerPhone,
      companyName: dto.companyName,
      assignedToUserId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
      assignedToEmail: userEmail,
      assignedToName: userName,
      lastMessage: dto.initialMessage || 'Conversation opened',
      lastMessageAt: new Date(),
      unreadCount: 0,
    });

    const saved = await newDoc.save();

    if (dto.initialMessage) {
      const msg = await this.messageModel.create({
        conversationId: saved._id,
        senderUserId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
        senderName: userName,
        senderEmail: userEmail,
        senderRole: MessageSenderRole.SALES_REP,
        content: dto.initialMessage,
        isInternal: Boolean(dto.isInternal),
        createdAt: new Date(),
      });

      this.wsService.broadcastMessageToRoom(saved._id.toString(), {
        id: msg._id.toString(),
        conversationId: saved._id.toString(),
        senderUserId: userId,
        senderName: userName,
        senderEmail: userEmail,
        senderRole: MessageSenderRole.SALES_REP,
        content: dto.initialMessage,
        isInternal: Boolean(dto.isInternal),
        createdAt: (msg as any).createdAt ? (msg as any).createdAt.toISOString() : new Date().toISOString(),
      });
    }

    const item = this.mapConversationDoc(saved.toObject());
    this.wsService.broadcastConversationUpdated(item);
    return item;
  }

  async updateConversationStatus(id: string, status: ConversationStatus): Promise<CrmConversationItem> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid conversation ID: ${id}`);
    }

    const updated = await this.conversationModel.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true },
    ).lean();

    if (!updated) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    const item = this.mapConversationDoc(updated);
    this.wsService.broadcastConversationUpdated(item);
    return item;
  }

  async listMessages(conversationId: string, requesterEmail?: string): Promise<CrmConversationMessageItem[]> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException(`Invalid conversation ID: ${conversationId}`);
    }

    const conv = await this.conversationModel.findById(conversationId).lean();
    const isCustomer = Boolean(
      conv &&
      (
        (requesterEmail && conv.customerEmail.toLowerCase() === requesterEmail.toLowerCase()) ||
        conv.organizationId // In customer organization conversations, keep internal staff notes private
      )
    );

    const filter: any = { conversationId: new Types.ObjectId(conversationId) };
    if (isCustomer) {
      filter.isInternal = { $ne: true };
    }

    const messages = await this.messageModel
      .find(filter)
      .sort({ createdAt: 1 })
      .lean();

    return messages.map((m) => ({
      id: m._id.toString(),
      conversationId: m.conversationId.toString(),
      senderUserId: m.senderUserId?.toString(),
      senderName: m.senderName,
      senderEmail: m.senderEmail,
      senderRole: m.senderRole,
      content: m.content,
      isInternal: Boolean(m.isInternal),
      attachments: (m as any).attachments || [],
      createdAt: (m as any).createdAt,
    }));
  }

  async postMessage(
    userId: string,
    userEmail: string,
    userName: string,
    conversationId: string,
    dto: PostMessageDto,
  ): Promise<CrmConversationMessageItem> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException(`Invalid conversation ID: ${conversationId}`);
    }

    const conv = await this.conversationModel.findById(conversationId);
    if (!conv) {
      throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
    }

    const isCustomer =
      conv.customerEmail.toLowerCase() === userEmail.toLowerCase() ||
      Boolean(conv.organizationId);
    const effectiveRole = isCustomer ? MessageSenderRole.CUSTOMER : MessageSenderRole.SALES_REP;
    const effectiveInternal = isCustomer ? false : Boolean(dto.isInternal);

    const message = await this.messageModel.create({
      conversationId: conv._id,
      senderUserId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
      senderName: userName || userEmail || (isCustomer ? 'Customer' : 'Staff'),
      senderEmail: userEmail,
      senderRole: effectiveRole,
      content: dto.content,
      isInternal: effectiveInternal,
      attachments: dto.attachments || [],
      createdAt: new Date(),
    });

    conv.lastMessage = effectiveInternal ? `[Internal Note] ${dto.content.substring(0, 60)}` : dto.content.substring(0, 80);
    conv.lastMessageAt = new Date();
    if (isCustomer) {
      conv.status = ConversationStatus.OPEN;
      conv.unreadCount = (conv.unreadCount || 0) + 1;
    }
    await conv.save();

    const formattedMessage: CrmConversationMessageItem = {
      id: message._id.toString(),
      conversationId: conversationId,
      senderUserId: message.senderUserId?.toString(),
      senderName: message.senderName,
      senderEmail: message.senderEmail,
      senderRole: message.senderRole,
      content: message.content,
      isInternal: Boolean(message.isInternal),
      attachments: (message as any).attachments || [],
      createdAt: (message as any).createdAt,
    };

    // Live broadcast via WebSocket to room participants
    this.wsService.broadcastMessageToRoom(conversationId, formattedMessage);

    // Live broadcast conversation preview to staff
    this.wsService.broadcastConversationUpdated(this.mapConversationDoc(conv.toObject()));

    return formattedMessage;
  }

  async checkLeadStatus(conversationId: string): Promise<CheckLeadStatusResult> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException(`Invalid conversation ID: ${conversationId}`);
    }

    const conv = await this.conversationModel.findById(conversationId).lean();
    if (!conv) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    let linkedLead: any = null;
    if (conv.leadId) {
      linkedLead = await this.leadModel.findById(conv.leadId).lean();
    }

    const email = (conv.customerEmail || '').toLowerCase().trim();
    const isGenericCompany =
      !conv.companyName ||
      conv.companyName.toLowerCase().trim() === 'client workspace';

    const orConditions: any[] = [];
    if (email) {
      orConditions.push({ contactEmail: email });
    }
    if (!isGenericCompany) {
      orConditions.push({ company: conv.companyName }, { companyName: conv.companyName });
    }

    const matchingLeads =
      orConditions.length > 0
        ? await this.leadModel
            .find({ $or: orConditions })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean()
        : [];

    return {
      isLinked: Boolean(conv.leadId),
      leadId: conv.leadId?.toString(),
      lead: linkedLead
        ? {
            id: linkedLead._id.toString(),
            title: linkedLead.title,
            stage: linkedLead.stage,
            dealValue: linkedLead.dealValue || linkedLead.estimatedValue || 0,
            company: linkedLead.company || linkedLead.companyName,
            contactName: linkedLead.contactName,
            contactEmail: linkedLead.contactEmail,
          }
        : undefined,
      matchingLeads: matchingLeads.map((item) => ({
        id: item._id.toString(),
        title: item.title,
        stage: item.stage,
        dealValue: item.dealValue || item.estimatedValue || 0,
        company: item.company || item.companyName,
        contactName: item.contactName,
        contactEmail: item.contactEmail,
        createdAt: (item as any).createdAt,
      })),
    };
  }

  async convertToLead(
    userId: string,
    userEmail: string,
    userName: string,
    conversationId: string,
    dto: ConvertToLeadDto,
    organizationId?: string,
  ): Promise<ConvertToLeadResult> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException(`Invalid conversation ID: ${conversationId}`);
    }

    const conv = await this.conversationModel.findById(conversationId);
    if (!conv) {
      throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
    }

    if (conv.leadId) {
      throw new ConflictException({
        code: 'CONVERSATION_ALREADY_CONVERTED',
        message: `This conversation is already linked to Lead ID: ${conv.leadId.toString()}`,
        leadId: conv.leadId.toString(),
      });
    }

    let targetLead: LeadDocument | null = null;
    let isExisting = false;

    if (dto.existingLeadId) {
      if (!Types.ObjectId.isValid(dto.existingLeadId)) {
        throw new BadRequestException(`Invalid existingLeadId: ${dto.existingLeadId}`);
      }
      targetLead = await this.leadModel.findById(dto.existingLeadId);
      if (!targetLead) {
        throw new NotFoundException(`Target lead ${dto.existingLeadId} not found`);
      }
      isExisting = true;

      if (!targetLead.conversationId) {
        targetLead.conversationId = conv._id;
      }
      targetLead.interactions = targetLead.interactions || [];
      targetLead.interactions.push({
        id: randomUUID(),
        type: 'EMAIL',
        summary: `Linked to Customer Conversation: ${conv.title}`,
        notes: dto.notes || dto.businessRequirements || conv.lastMessage || 'Conversation linked to deal',
        performedBy: userName,
        createdAt: new Date(),
      });
      await targetLead.save();
    } else {
      const company = dto.companyName || conv.companyName || conv.customerName || 'Modernization Client';
      const title = `${company} - Modernization Deal`;
      const sourceRef = `conv_${conv._id.toString()}_${Date.now()}`;
      let orgId: Types.ObjectId;
      if (organizationId && Types.ObjectId.isValid(organizationId)) {
        orgId = new Types.ObjectId(organizationId);
      } else if (conv.organizationId && Types.ObjectId.isValid(conv.organizationId)) {
        orgId = conv.organizationId;
      } else {
        let defaultOrg: any = null;
        if (this.leadModel.db && typeof (this.leadModel.db as any).collection === 'function') {
          defaultOrg = await this.leadModel.db.collection('organizations').findOne({
            $or: [
              { name: { $regex: 'System Administrator', $options: 'i' } },
              { type: 'PLATFORM' },
            ],
          });
        }
        orgId = defaultOrg ? defaultOrg._id : new Types.ObjectId('6ad8fc078e245232a0a8385a');
      }

      const initialAssignment = {
        id: randomUUID(),
        teamId: 'internal_sales_team',
        salespersonId: userId,
        startedAt: new Date(),
        actorUserId: userId,
        expectedRevision: 0,
      };

      const initialInteraction = {
        id: randomUUID(),
        type: 'EMAIL' as const,
        summary: `Converted from Customer Conversation: "${conv.title}"`,
        notes: dto.businessRequirements || conv.lastMessage || 'Customer inquiry via Web1 portal chat',
        details: dto.businessRequirements || conv.lastMessage || 'Customer inquiry via Web1 portal chat',
        performedBy: userName,
        createdAt: new Date(),
        timestamp: new Date().toISOString(),
      };

      const dealVal = Number(dto.estimatedValue) || 0;

      targetLead = await this.leadModel.create({
        status: LeadStatus.ASSIGNED,
        organizationId: orgId,
        title,
        sourceReference: sourceRef,
        contactEmail: conv.customerEmail.toLowerCase().trim(),
        contactName: conv.customerName,
        company,
        companyName: company,
        phone: conv.customerPhone,
        source: 'CONVERSATION',
        stage: 'NEW',
        score: 65,
        dealValue: dealVal,
        estimatedValue: dealVal,
        currency: 'VND',
        priority: dto.priority || 'MEDIUM',
        estimatedScreens: Number(dto.estimatedScreens) || 0,
        estimatedPrograms: Number(dto.estimatedPrograms) || 0,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        businessRequirements: dto.businessRequirements || conv.title,
        notes: dto.notes,
        assignedToUserId: conv.assignedToUserId || (Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined),
        assignedToName: conv.assignedToName || userName,
        assignedTo: conv.assignedToName || userName,
        conversationId: conv._id,
        creationFingerprint: randomBytes(16).toString('hex'),
        revision: 0,
        assignments: [initialAssignment],
        interactions: [initialInteraction],
        demos: [],
        quotes: [],
        contracts: [],
      });
    }

    conv.leadId = targetLead._id;
    if (conv.status === ConversationStatus.OPEN) {
      conv.status = ConversationStatus.IN_PROGRESS;
    }
    await conv.save();

    this.wsService.broadcastConversationUpdated({
      id: conv._id.toString(),
      title: conv.title,
      status: conv.status,
      customerName: conv.customerName,
      customerEmail: conv.customerEmail,
      companyName: conv.companyName,
      leadId: conv.leadId.toString(),
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt,
      unreadCount: conv.unreadCount || 0,
    });

    return {
      success: true,
      leadId: targetLead._id.toString(),
      leadTitle: targetLead.title,
      stage: targetLead.stage,
      dealValue: targetLead.dealValue || targetLead.estimatedValue || 0,
      contactEmail: targetLead.contactEmail || conv.customerEmail,
      contactName: targetLead.contactName || conv.customerName,
      company: targetLead.company || targetLead.companyName || conv.companyName || 'Unknown',
      conversationId: conv._id.toString(),
      isExistingLinked: isExisting,
    };
  }

}
