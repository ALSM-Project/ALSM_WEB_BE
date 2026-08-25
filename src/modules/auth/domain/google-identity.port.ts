export interface GoogleIdentity {
  email: string;
  fullName: string;
}

export interface GoogleIdentityPort {
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
}

export const GOOGLE_IDENTITY_PORT = Symbol('GOOGLE_IDENTITY_PORT');
