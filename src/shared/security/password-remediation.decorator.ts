import { SetMetadata } from '@nestjs/common';

// Method-only admission for the two credential remediation handlers. Session
// ownership, generation, account activation and expiry are still mandatory.
export const PASSWORD_REMEDIATION = 'auth:password-remediation';
export const PasswordRemediation = () => SetMetadata(PASSWORD_REMEDIATION, true);
