import { ForbiddenException } from '@nestjs/common';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationRecord } from '../src/modules/organizations/domain/organization.repository';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';

describe.each(['test', 'development', 'production'])(
  'Organization authorization in %s',
  (environment) => {
    const originalEnvironment = process.env.NODE_ENV;
    const service = new OrganizationAuthorizationService();
    const organization: OrganizationRecord = {
      id: 'org-a',
      name: 'A',
      type: OrganizationType.SELF_SERVICE,
      members: [
        { userId: 'owner', role: OrganizationRole.OWNER },
        { userId: 'viewer', role: OrganizationRole.VIEWER },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    beforeEach(() => {
      process.env.NODE_ENV = environment;
    });
    afterEach(() => {
      if (originalEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnvironment;
    });

    it.each(['viewer', 'non-member'])('denies %s with the stable 403 code', (userId) => {
      let error: unknown;
      try {
        service.require(organization, userId, [OrganizationRole.OWNER]);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error).toMatchObject({
        status: 403,
        response: { code: 'ORGANIZATION_ACCESS_DENIED' },
      });
    });

    it('allows an authorized role', () => {
      expect(() => service.require(organization, 'owner', [OrganizationRole.OWNER])).not.toThrow();
    });
  },
);
