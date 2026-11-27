import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Meeting, MeetingDocument } from '../infrastructure/meeting.schema';
import { MeetingStatus } from '../domain/meeting.types';
import { MeetingRequest, MeetingRequestDocument } from '../infrastructure/meeting-request.schema';
import { MeetingRequestStatus } from '../domain/meeting-request.types';
import { Lead, LeadDocument } from '../../crm/infrastructure/lead.schema';

export type CustomerMeetingCategoryStatus = 'UPCOMING' | 'COMPLETED' | 'CANCELLED';

export interface CustomerMeetingItem {
  id: string;
  source: 'MEETING' | 'MEETING_REQUEST' | 'LEAD_DEMO';
  title: string;
  purpose: string;
  agenda: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  timezone: string;
  organizerName: string;
  organizerEmail: string;
  platform: string;
  meetingUrl?: string;
  participants: string[];
  status: CustomerMeetingCategoryStatus;
  rawStatus: string;
}

@Injectable()
export class CustomerMeetingsService {
  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(MeetingRequest.name) private readonly meetingRequestModel: Model<MeetingRequestDocument>,
    @Optional() @InjectModel(Lead.name) private readonly leadModel?: Model<LeadDocument>,
  ) {}

  private mapMeetingStatus(status: string): CustomerMeetingCategoryStatus {
    if (status === MeetingStatus.COMPLETED) return 'COMPLETED';
    if (status === MeetingStatus.CANCELLED) return 'CANCELLED';
    return 'UPCOMING';
  }

  private mapRequestStatus(status: string): CustomerMeetingCategoryStatus {
    if (status === MeetingRequestStatus.COMPLETED) return 'COMPLETED';
    if (status === MeetingRequestStatus.CANCELLED || status === MeetingRequestStatus.NO_SHOW) {
      return 'CANCELLED';
    }
    return 'UPCOMING';
  }

  private formatPlatform(format?: string): string {
    if (!format || format === 'GOOGLE_MEET') return 'Google Meet';
    if (format === 'ZOOM') return 'Zoom';
    if (format === 'MICROSOFT_TEAMS') return 'Microsoft Teams';
    if (format === 'PHONE') return 'Phone Call';
    if (format === 'IN_PERSON') return 'In Person';
    return format;
  }

  async listForCustomer(caller: {
    userId: string;
    email: string;
    organizationId?: string;
  }): Promise<CustomerMeetingItem[]> {
    const email = caller.email.toLowerCase().trim();
    const results: CustomerMeetingItem[] = [];

    // 1. Direct Meeting rooms (UC-43) where customer is an attendee
    const meetingDocs = await this.meetingModel
      .find({ attendeeEmails: email })
      .sort({ scheduledStartTime: 1 })
      .lean()
      .exec();

    for (const m of meetingDocs) {
      results.push({
        id: `meeting:${m._id.toString()}`,
        source: 'MEETING',
        title: m.title,
        purpose: 'Consultation & Project Sync',
        agenda: m.description || 'Scheduled ALSM session.',
        scheduledStartTime: new Date(m.scheduledStartTime).toISOString(),
        scheduledEndTime: new Date(m.scheduledEndTime).toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        organizerName: m.hostEmail.split('@')[0] || 'ALSM Specialist',
        organizerEmail: m.hostEmail,
        platform: 'Google Meet',
        meetingUrl: m.meetingUrl || undefined,
        participants: m.attendeeEmails || [],
        status: this.mapMeetingStatus(m.status),
        rawStatus: m.status,
      });
    }

    // 2. Consultation Meeting Requests associated with this customer / organization
    const mrOr: any[] = [
      { 'customer.email': email },
      { 'scheduling.attendeeEmails': email },
    ];
    if (Types.ObjectId.isValid(caller.userId)) {
      mrOr.push({ 'customer.userId': new Types.ObjectId(caller.userId) });
    }
    if (caller.organizationId && Types.ObjectId.isValid(caller.organizationId)) {
      mrOr.push({ 'customer.organizationId': new Types.ObjectId(caller.organizationId) });
    }

    const requestDocs = await this.meetingRequestModel
      .find({
        $or: mrOr,
        'scheduling.scheduledStartTime': { $exists: true, $ne: null },
      })
      .sort({ 'scheduling.scheduledStartTime': 1 })
      .lean()
      .exec();

    for (const r of requestDocs) {
      const start = r.scheduling?.scheduledStartTime
        ? new Date(r.scheduling.scheduledStartTime)
        : new Date(r.createdAt);
      const durationMs = (r.scheduling?.durationMinutes || 45) * 60_000;
      const end = r.scheduling?.scheduledEndTime
        ? new Date(r.scheduling.scheduledEndTime)
        : new Date(start.getTime() + durationMs);

      const organizerEmail = r.assignment?.assignedSalesEmail || 'support@alsm.io';
      const organizerName = r.assignment?.assignedSalesName || 'ALSM Specialist';
      const participants = Array.from(
        new Set([
          r.customer?.email,
          ...(r.scheduling?.attendeeEmails || []),
          organizerEmail,
        ].filter(Boolean) as string[]),
      );

      results.push({
        id: `request:${r._id.toString()}`,
        source: 'MEETING_REQUEST',
        title: r.topic,
        purpose: r.consultationType ? r.consultationType.replace(/_/g, ' ') : 'Consultation',
        agenda:
          r.requirements?.businessRequirements ||
          r.requirements?.technicalRequirements ||
          r.topic,
        scheduledStartTime: start.toISOString(),
        scheduledEndTime: end.toISOString(),
        timezone: r.scheduling?.timezone || 'Asia/Ho_Chi_Minh',
        organizerName,
        organizerEmail,
        platform: this.formatPlatform(r.scheduling?.format),
        meetingUrl: r.scheduling?.meetingUrl || undefined,
        participants,
        status: this.mapRequestStatus(r.status),
        rawStatus: r.status,
      });
    }

    // 3. Lead Demos scheduled via Web 2 ScheduleDemoModal
    if (this.leadModel) {
      const leadOr: any[] = [
        { contactEmail: email },
        { 'demos.attendees': email },
      ];
      if (caller.organizationId && Types.ObjectId.isValid(caller.organizationId)) {
        leadOr.push({ organizationId: new Types.ObjectId(caller.organizationId) });
      }

      const leads = await this.leadModel
        .find({ $or: leadOr, 'demos.0': { $exists: true } })
        .lean()
        .exec();

      for (const lead of leads) {
        const leadAny = lead as any;
        for (const demo of (lead.demos || []) as any[]) {
          const demoStart = new Date(demo.scheduledAt);
          const demoEnd = new Date(demoStart.getTime() + (demo.durationMinutes || 45) * 60_000);
          const status = this.mapMeetingStatus(demo.status || 'SCHEDULED');

          results.push({
            id: `demo:${lead._id.toString()}:${demo.id}`,
            source: 'LEAD_DEMO',
            title: demo.title,
            purpose: 'Product Demo',
            agenda: demo.description || `Modernization demo for ${lead.company || lead.contactName}`,
            scheduledStartTime: demoStart.toISOString(),
            scheduledEndTime: demoEnd.toISOString(),
            timezone: 'Asia/Ho_Chi_Minh',
            organizerName: leadAny.assignedToName || 'ALSM Solutions Specialist',
            organizerEmail: leadAny.assignedToEmail || 'sales@alsm.io',
            platform: 'Google Meet',
            meetingUrl: demo.meetLink || undefined,
            participants: demo.attendees?.length ? demo.attendees : [lead.contactEmail],
            status,
            rawStatus: demo.status || 'SCHEDULED',
          });
        }
      }
    }

    // Sort upcoming soonest first, then past/cancelled most recent first
    return results.sort(
      (a, b) => new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime(),
    );
  }

  async getForCustomerById(
    id: string,
    caller: { userId: string; email: string; organizationId?: string },
  ): Promise<CustomerMeetingItem> {
    const all = await this.listForCustomer(caller);
    const found = all.find((m) => m.id === id);
    if (!found) {
      // Check if it's a raw ObjectId without prefix
      const bySuffix = all.find((m) => m.id.endsWith(`:${id}`));
      if (bySuffix) return bySuffix;
      throw new NotFoundException('Meeting not found or you do not have access to it.');
    }
    return found;
  }
}
