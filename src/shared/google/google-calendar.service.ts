import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, calendar_v3 } from 'googleapis';

export interface GoogleMeetResult {
  meetingUrl: string;
  meetingCode: string;
  calendarEventId: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private calendar: calendar_v3.Calendar | null = null;
  private calendarId: string = 'primary';

  constructor(private readonly config: ConfigService) {
    const serviceAccountJson = this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_JSON', '');
    const userEmail = this.config.get<string>('GOOGLE_CALENDAR_USER_EMAIL', '');

    if (!serviceAccountJson) {
      this.logger.warn(
        'GOOGLE_SERVICE_ACCOUNT_JSON not configured — Google Calendar integration DISABLED. ' +
          'Set this env var with the service account JSON to enable real Meet link creation.',
      );
      return;
    }

    try {
      const credentials = JSON.parse(serviceAccountJson) as {
        client_email: string;
        private_key: string;
      };

      // Domain-wide delegation: impersonate the user who will host the calendar event
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar'],
        subject: userEmail || undefined, // impersonate this user
      });

      this.calendar = google.calendar({ version: 'v3', auth });
      this.calendarId = userEmail || 'primary';
      this.logger.log(
        `GoogleCalendarService initialized — service account: ${credentials.client_email}` +
          (userEmail ? ` | impersonating: ${userEmail}` : ''),
      );
    } catch (err) {
      this.logger.error(
        `Failed to initialize GoogleCalendarService: ${(err as Error).message}. Check GOOGLE_SERVICE_ACCOUNT_JSON format.`,
      );
    }
  }

  get isEnabled(): boolean {
    return this.calendar !== null;
  }

  /**
   * Create a real Google Calendar event with Google Meet conferencing.
   * Returns the real Meet URL, code, and calendar event ID.
   */
  async createMeetingEvent(params: {
    title: string;
    description: string;
    attendeeEmails: string[];
    hostEmail: string;
    scheduledStartTime: Date;
    scheduledEndTime: Date;
  }): Promise<GoogleMeetResult> {
    if (!this.calendar) {
      throw new Error('Google Calendar integration is not configured');
    }

    const { title, description, attendeeEmails, hostEmail, scheduledStartTime, scheduledEndTime } = params;

    const allAttendees = [
      { email: hostEmail, responseStatus: 'accepted' as const },
      ...attendeeEmails
        .filter((e) => e !== hostEmail)
        .map((email) => ({ email, responseStatus: 'needsAction' as const })),
    ];

    const event: calendar_v3.Schema$Event = {
      summary: title,
      description,
      start: {
        dateTime: scheduledStartTime.toISOString(),
        timeZone: 'Asia/Ho_Chi_Minh',
      },
      end: {
        dateTime: scheduledEndTime.toISOString(),
        timeZone: 'Asia/Ho_Chi_Minh',
      },
      attendees: allAttendees,
      conferenceData: {
        createRequest: {
          requestId: `alsm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 30 },
          { method: 'popup', minutes: 10 },
        ],
      },
      guestsCanModify: false,
      guestsCanSeeOtherGuests: true,
    };

    const response = await this.calendar.events.insert({
      calendarId: this.calendarId,
      conferenceDataVersion: 1, // required to generate Meet link
      sendUpdates: 'all',
      requestBody: event,
    });

    const createdEvent = response.data;
    const meetLink = createdEvent.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === 'video',
    )?.uri;

    if (!meetLink) {
      throw new Error('Google Calendar API did not return a Meet conferencing link');
    }

    const meetCode = meetLink.replace('https://meet.google.com/', '');
    this.logger.log(`Real Google Meet created: ${meetLink} | Event ID: ${createdEvent.id}`);

    return {
      meetingUrl: meetLink,
      meetingCode: meetCode,
      calendarEventId: createdEvent.id ?? '',
    };
  }
}
