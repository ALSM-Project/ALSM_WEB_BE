import { ConfigService } from '@nestjs/config';
import { auth, calendar } from 'googleapis/build/src/apis/calendar';
import { GoogleCalendarService } from '../src/shared/google/google-calendar.service';

jest.mock('googleapis/build/src/apis/calendar', () => ({
  auth: { JWT: jest.fn() },
  calendar: jest.fn(),
}));

describe('GoogleCalendarService calendar-only SDK import', () => {
  const insert = jest.fn();
  const input = {
    title: 'Local test meeting',
    description: 'Transport is mocked; no Google requests',
    hostEmail: 'host@example.invalid',
    attendeeEmails: ['host@example.invalid', 'guest@example.invalid'],
    scheduledStartTime: new Date('2026-10-18T10:00:00Z'),
    scheduledEndTime: new Date('2026-10-18T11:00:00Z'),
  };
  beforeEach(() => {
    jest.clearAllMocks();
    (calendar as jest.Mock).mockReturnValue({ events: { insert } });
  });

  it('stays disabled and rejects event creation when no service account is configured', async () => {
    const service = new GoogleCalendarService(new ConfigService({}));
    expect(service.isEnabled).toBe(false);
    expect(calendar).not.toHaveBeenCalled();
    await expect(service.createMeetingEvent(input)).rejects.toThrow('not configured');
    expect(insert).not.toHaveBeenCalled();
  });

  it('preserves delegated JWT configuration and Calendar v3 meeting requests', async () => {
    const service = new GoogleCalendarService(
      new ConfigService({
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: 'local@example.invalid',
          private_key: 'TEST_KEY_NO_CREDENTIAL',
        }),
        GOOGLE_CALENDAR_USER_EMAIL: input.hostEmail,
      }),
    );
    expect(auth.JWT).toHaveBeenCalledWith({
      email: 'local@example.invalid',
      key: 'TEST_KEY_NO_CREDENTIAL',
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject: input.hostEmail,
    });
    expect(calendar).toHaveBeenCalledWith({ version: 'v3', auth: expect.any(Object) });
    insert.mockResolvedValue({
      data: {
        id: 'fixture-event',
        conferenceData: {
          entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
        },
      },
    });
    await expect(service.createMeetingEvent(input)).resolves.toEqual({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      meetingCode: 'abc-defg-hij',
      calendarEventId: 'fixture-event',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: input.hostEmail,
        conferenceDataVersion: 1,
        sendUpdates: 'all',
        requestBody: expect.objectContaining({
          summary: input.title,
          attendees: [
            { email: input.hostEmail, responseStatus: 'accepted' },
            { email: 'guest@example.invalid', responseStatus: 'needsAction' },
          ],
        }),
      }),
    );
  });
});
