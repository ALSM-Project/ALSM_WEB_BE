import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { GoogleIdentity, GoogleIdentityPort } from '../domain/google-identity.port';

@Injectable()
export class GoogleIdentityVerifierAdapter implements GoogleIdentityPort {
  private readonly client: OAuth2Client;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.client = new OAuth2Client();
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const audience = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    if (!audience) {
      throw new UnauthorizedException({
        code: 'GOOGLE_SIGN_IN_DISABLED',
        message: 'Google sign-in is not configured',
      });
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_GOOGLE_TOKEN',
        message: 'Google token is invalid or expired',
      });
    }

    if (!payload || !payload.sub || !payload.email) {
      throw new UnauthorizedException({
        code: 'INVALID_GOOGLE_TOKEN',
        message: 'Google token is missing required claims',
      });
    }

    if (!payload.email_verified) {
      throw new UnauthorizedException({
        code: 'GOOGLE_EMAIL_NOT_VERIFIED',
        message: 'Google account email is not verified',
      });
    }

    return {
      email: payload.email.toLowerCase(),
      fullName: payload.name?.trim() || payload.email.split('@')[0],
    };
  }
}
