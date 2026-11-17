import { NavigationService } from '../src/modules/menus/application/services/navigation.service';
import { BootstrapCacheService } from '../src/modules/menus/application/services/bootstrap-cache.service';
import { AuthService } from '../src/modules/auth/application/auth.service';

describe('Big Tech Entitlements + Capabilities Architecture Specification', () => {
  let navigationService: NavigationService;
  let bootstrapCache: BootstrapCacheService;
  let mockNavRepo: any;
  let mockEffectivePerms: any;
  let mockConnection: any;

  beforeEach(() => {
    bootstrapCache = new BootstrapCacheService();

    mockNavRepo = {
      findActiveVisibleMenuItems: jest.fn().mockResolvedValue([]),
      findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(new Map()),
    };

    mockEffectivePerms = {
      getEffectivePermissions: jest.fn().mockResolvedValue(['dashboard.view']),
      getUserRoles: jest.fn().mockResolvedValue(['MEMBER']),
    };

    mockConnection = {
      db: {
        collection: jest.fn().mockImplementation((name: string) => {
          if (name === 'users') {
            return {
              findOne: jest.fn().mockResolvedValue({
                _id: 'user-001',
                email: 'customer@acme.com',
                fullName: 'John Doe',
                role: 'ENTERPRISE_ADMIN',
                organizationId: 'org-001',
              }),
            };
          }
          if (name === 'organizations') {
            return {
              findOne: jest.fn().mockResolvedValue({
                _id: 'org-001',
                name: 'ACME Corp',
                tier: 'ENTERPRISE',
                status: 'ACTIVE',
                screenCapacity: 2500,
                members: [{ userId: 'user-001', role: 'ENTERPRISE_ADMIN' }],
              }),
            };
          }
          if (name === 'contracts') {
            return {
              find: jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue([
                    {
                      contractNumber: 'CTR-2026-001',
                      status: 'ACTIVE',
                      serviceMode: 'WE_CONVERT_FOR_YOU',
                      endDate: '2027-01-01',
                      customerUserId: 'user-001',
                    },
                  ]),
                }),
              }),
              findOne: jest.fn().mockResolvedValue({
                contractNumber: 'CTR-2026-001',
                status: 'ACTIVE',
                serviceMode: 'WE_CONVERT_FOR_YOU',
                endDate: '2027-01-01',
                screenLimit: 2500,
              }),
            };
          }
          if (name === 'projects') {
            return {
              find: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue([
                    { screenCount: 20, conversionsCount: 5 },
                  ]),
                }),
              }),
            };
          }
          return { findOne: jest.fn().mockResolvedValue(null) };
        }),
      },
    };

    navigationService = new NavigationService(
      mockNavRepo,
      mockEffectivePerms,
      mockConnection,
      bootstrapCache,
    );
  });

  describe('1. Single Unified Bootstrap Endpoint', () => {
    it('returns user, organization, active contract, quotas, and capabilities in one call', async () => {
      const bootstrap = await navigationService.getSessionBootstrap('user-001', 'customer@acme.com');

      expect(bootstrap.user.id).toBe('user-001');
      expect(bootstrap.user.email).toBe('customer@acme.com');
      expect(bootstrap.organization.name).toBe('ACME Corp');
      expect(bootstrap.contract.contractNumber).toBe('CTR-2026-001');
      expect(bootstrap.contract.serviceMode).toBe('WE_CONVERT_FOR_YOU');
      expect(bootstrap.contract.status).toBe('ACTIVE');
      expect(bootstrap.contract.isReadOnly).toBe(false);
      expect(bootstrap.quotas.screensLimit).toBe(2500);
      expect(bootstrap.quotas.screensUsed).toBe(20);
      expect(Array.isArray(bootstrap.capabilities)).toBe(true);
    });
  });

  describe('2. Capabilities Engine: Mode & Role & Contract State', () => {
    it('grants managed capabilities and excludes workbench compiler write capabilities for Managed contracts', async () => {
      const bootstrap = await navigationService.getSessionBootstrap('user-001', 'customer@acme.com');

      expect(bootstrap.capabilities).toContain('dashboard.managed');
      expect(bootstrap.capabilities).toContain('deliverable.view');
      expect(bootstrap.capabilities).toContain('deliverable.download');
      expect(bootstrap.capabilities).toContain('deliverable.signoff');
      expect(bootstrap.capabilities).toContain('conversion_request.create');

      // Compiler workbench write operations are not granted on Managed mode
      expect(bootstrap.capabilities).not.toContain('screen.convert');
      expect(bootstrap.capabilities).not.toContain('code.bulk_convert');
      expect(bootstrap.capabilities).not.toContain('field_mapping.edit');
    });

    it('enforces read-only capabilities when contract is SUSPENDED or EXPIRED', async () => {
      // Mock suspended contract
      mockConnection.db.collection = jest.fn().mockImplementation((name: string) => {
        if (name === 'users') {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: 'user-002',
              email: 'suspended@acme.com',
              role: 'ENTERPRISE_ADMIN',
            }),
          };
        }
        if (name === 'organizations') {
          return { findOne: jest.fn().mockResolvedValue({ _id: 'org-002', name: 'Suspended Org' }) };
        }
        if (name === 'contracts') {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                  {
                    contractNumber: 'CTR-SUSPENDED-01',
                    status: 'SUSPENDED',
                    serviceMode: 'SELF_SERVICE',
                    customerUserId: 'user-002',
                  },
                ]),
              }),
            }),
            findOne: jest.fn().mockResolvedValue({
              contractNumber: 'CTR-SUSPENDED-01',
              status: 'SUSPENDED',
            }),
          };
        }
        return {
          find: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }) }),
          findOne: jest.fn().mockResolvedValue(null),
        };
      });

      const bootstrap = await navigationService.getSessionBootstrap('user-002', 'suspended@acme.com');

      expect(bootstrap.contract.isReadOnly).toBe(true);
      expect(bootstrap.contract.status).toBe('SUSPENDED');
      expect(bootstrap.capabilities).toContain('contract.is_read_only');
      expect(bootstrap.capabilities).toContain('contract.view');
      expect(bootstrap.capabilities).toContain('invoice.view');

      // All mutating capabilities are stripped
      expect(bootstrap.capabilities).not.toContain('screen.convert');
      expect(bootstrap.capabilities).not.toContain('project.create');
      expect(bootstrap.capabilities).not.toContain('organization.profile.update');
    });

    it('grants full leadership capabilities and navigationTree to PARTNER role with Managed contract', async () => {
      mockConnection.db.collection = jest.fn().mockImplementation((name: string) => {
        if (name === 'users') {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: 'user-partner',
              email: 'partner@enterprise.com',
              role: 'PARTNER',
              organizationId: 'org-001',
            }),
          };
        }
        if (name === 'organizations') {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: 'org-001',
              name: 'Enterprise Partner Org',
              serviceMode: 'WE_CONVERT_FOR_YOU',
            }),
          };
        }
        if (name === 'contracts') {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                  {
                    contractNumber: 'CTR-PARTNER-01',
                    status: 'ACTIVE',
                    serviceMode: 'WE_CONVERT_FOR_YOU',
                  },
                ]),
              }),
            }),
            findOne: jest.fn().mockResolvedValue({
              contractNumber: 'CTR-PARTNER-01',
              status: 'ACTIVE',
              serviceMode: 'WE_CONVERT_FOR_YOU',
            }),
          };
        }
        return {
          find: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([]),
            }),
          }),
        };
      });

      const bootstrap = await navigationService.getSessionBootstrap('user-partner', 'partner@enterprise.com');

      expect(bootstrap.capabilities).toContain('dashboard.managed');
      expect(bootstrap.capabilities).toContain('organization.view');
      expect(bootstrap.capabilities).toContain('organization.profile.view');
      expect(bootstrap.capabilities).toContain('conversations.view');
      expect(bootstrap.capabilities).toContain('deliverable.view');
      expect(bootstrap.navigationTree).toBeDefined();
    });
  });

  describe('3. Stale-While-Revalidate Caching & Invalidation', () => {
    it('caches bootstrap results and purges on demand when contract status changes', async () => {
      const first = await navigationService.getSessionBootstrap('user-001', 'customer@acme.com');

      // Second call hits cache
      const cached = bootstrapCache.get('user-001', 'org-001', 'CTR-2026-001');
      expect(cached).not.toBeNull();
      expect(cached?.data.sourceTimestamp).toBe(first.sourceTimestamp);

      // Event invalidation
      navigationService.invalidateBootstrapCache('user-001', 'org-001');
      const afterInvalidate = bootstrapCache.get('user-001', 'org-001', 'CTR-2026-001');
      expect(afterInvalidate).toBeNull();
    });
  });
});
