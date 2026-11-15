import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { ApplicationContext } from '../../domain/enums/menu.enums';
import { EffectivePermissionsService } from '../../../rbac/application/effective-permissions.service';
import {
  INavigationRepository,
  NAVIGATION_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';
import { BootstrapCacheService } from './bootstrap-cache.service';
import { SessionBootstrapPayload } from '../types/session-bootstrap.types';
import {
  CAPABILITY_REGISTRY,
  VALID_CAPABILITY_KEYS,
  isValidCapability,
} from '../../domain/capabilities.constants';

export interface NavNode {
  id: string;
  key: string;
  application: string;
  label: string;
  type: string;
  icon: string;
  route: string | null;
  parentId: string | null;
  order: number;
  visibility: boolean;
  status: string;
  requiredPermissions: string[];
  openInNewTab?: boolean;
  hideParentLabel?: boolean;
  contractTypeVisibility?: string;
  featureKey?: string | null;
  description?: string | null;
  requiredRoles?: string[];
  capability?: string;
  children?: NavNode[];
}

export interface NavigationQueryOptions {
  contractType?: string;
  role?: string;
}

export interface AuthoritativeContractContext {
  organizationId: string | null;
  organizationName: string;
  serviceMode: 'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU' | 'HYBRID';
  contractType?: 'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU';
  contractStatus: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'TRIAL' | 'NONE';
  contractNumber: string | null;
  role: string;
  permissions: string[];
}

@Injectable()
export class NavigationService {
  private readonly logger = new Logger(NavigationService.name);
  private readonly warnedMissingCapabilityKeys = new Set<string>();

  constructor(
    @Inject(NAVIGATION_REPOSITORY)
    private readonly navigationRepo: INavigationRepository,
    private readonly effectivePermissionsService: EffectivePermissionsService,
    @Optional()
    @InjectConnection()
    private readonly connection?: Connection,
    @Optional()
    private readonly bootstrapCache?: BootstrapCacheService,
  ) {}

  public computeUserCapabilities(
    role: string,
    serviceMode: 'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU' | 'HYBRID',
    contractStatus: string,
    isPlatformAdmin: boolean = false,
  ): Set<string> {
    const isReadOnly = contractStatus === 'SUSPENDED' || contractStatus === 'EXPIRED';
    const roleUpper = (role || 'MEMBER').toUpperCase();
    const isViewer = roleUpper === 'VIEWER';
    const isAdmin =
      roleUpper === 'ADMIN' ||
      roleUpper === 'ENTERPRISE_ADMIN' ||
      roleUpper === 'ORGANIZATION_OWNER' ||
      roleUpper === 'OWNER' ||
      roleUpper === 'PARTNER' ||
      roleUpper === 'CUSTOMER' ||
      isPlatformAdmin;

    const caps = new Set<string>();

    // 1. Base Read Capabilities (All active enterprise portal users)
    caps.add('dashboard.view');
    caps.add('project.view');
    caps.add('contract.view');
    caps.add('invoice.view');
    caps.add('meeting.view');
    caps.add('meeting.schedule');
    caps.add('account.manage');
    caps.add('account.security');
    caps.add('service_usage.view');
    caps.add('project.files.view');
    caps.add('conversations.view');
    if (!isReadOnly && !isViewer) {
      caps.add('conversations.create');
    }

    // 2. Organization Management Capabilities
    // Note: organization.members.view and organization.teams.view granted to view-capable roles without mapping view -> manage
    if (isAdmin) {
      caps.add('organization.view');
      caps.add('organization.profile.view');
      caps.add('organization.members.view');
      caps.add('organization.teams.view');
      caps.add('organization.analytics.view');
      caps.add('organization.audit.view');
      if (!isReadOnly) {
        caps.add('organization.profile.update');
        caps.add('organization.members.invite');
        caps.add('organization.members.manage');
        caps.add('organization.teams.manage');
        caps.add('organization.roles.manage');
      }
    }

    // 3. Plan Entitlements (Service Mode: Self-Service vs Turnkey Managed)
    const hasSelfService = serviceMode === 'SELF_SERVICE' || serviceMode === 'HYBRID';
    const hasManaged = serviceMode === 'WE_CONVERT_FOR_YOU' || serviceMode === 'HYBRID';

    if (hasManaged) {
      caps.add('dashboard.managed');
      caps.add('deliverable.view');
      caps.add('deliverable.download');
      caps.add('conversion_request.view');

      if (!isReadOnly && !isViewer) {
        caps.add('deliverable.signoff');
        caps.add('conversion_request.create');
        caps.add('project.files.upload');
      }
    }

    if (hasSelfService) {
      caps.add('dashboard.self_service');
      caps.add('screen.view');
      caps.add('screen.inspect');
      caps.add('preview.studio');
      caps.add('version_history.view');
      caps.add('code.export');
      caps.add('quality_review.view');

      if (!isReadOnly && !isViewer) {
        caps.add('project.create');
        caps.add('project.delete');
        caps.add('screen.upload');
        caps.add('screen.convert');
        caps.add('code.bulk_convert');
        caps.add('field_mapping.edit');
        caps.add('method_mapping.edit');
        caps.add('quality_review.submit');
      }
    }

    // 4. Contract Status Fail-Closed Enforcements
    if (isReadOnly) {
      for (const cap of Array.from(caps)) {
        if (
          cap.endsWith('.create') ||
          cap.endsWith('.update') ||
          cap.endsWith('.edit') ||
          cap.endsWith('.delete') ||
          cap.endsWith('.convert') ||
          cap.endsWith('.upload') ||
          cap.endsWith('.signoff') ||
          cap.endsWith('.submit')
        ) {
          caps.delete(cap);
        }
      }
      caps.add('contract.is_read_only');
    }

    return caps;
  }

  async getAuthoritativeContractContext(
    userId: string,
    cachedPermissions?: string[],
    cachedRoles?: string[],
    cachedEmail?: string,
  ): Promise<AuthoritativeContractContext> {
    const userPermissions =
      cachedPermissions || (await this.effectivePermissionsService.getEffectivePermissions(userId));
    const userRoles =
      cachedRoles ||
      ((this.effectivePermissionsService.getUserRoles
        ? await this.effectivePermissionsService.getUserRoles(userId)
        : []) || []);

    let orgId: string | null = null;
    let orgName = 'Enterprise Organization';
    let serviceMode: 'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU' = 'SELF_SERVICE';
    let contractStatus: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'TRIAL' | 'NONE' = 'ACTIVE';
    let contractNumber: string | null = null;
    let detectedRole = userRoles[0] || 'MEMBER';

    if (this.connection?.db) {
      try {
        const userObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
        let email = (cachedEmail || '').toLowerCase().trim();
        let userOrgId: any = null;

        const usersCol = this.connection.db.collection('users');
        const userDoc = await usersCol.findOne({
          $or: [
            ...(userObjId ? [{ _id: userObjId }] : []),
            { _id: userId as any },
          ],
        });
        if (userDoc) {
          if (!email && userDoc.email) email = userDoc.email.toLowerCase().trim();
          if (userDoc.organizationId) userOrgId = userDoc.organizationId;
          if (userDoc.role && (detectedRole === 'MEMBER' || detectedRole === 'USER')) {
            detectedRole = String(userDoc.role).toUpperCase();
          }
        }

        const orgsCol = this.connection.db.collection('organizations');
        let org: any = null;
        if (userOrgId) {
          org = await orgsCol.findOne({
            $or: [
              ...(Types.ObjectId.isValid(userOrgId) ? [{ _id: new Types.ObjectId(userOrgId) }] : []),
              { _id: userOrgId },
              { _id: userOrgId.toString() },
            ],
          });
        }
        if (!org) {
          org = await orgsCol.findOne({
            $or: [
              ...(userObjId ? [{ 'members.userId': userObjId }] : []),
              { 'members.userId': userId },
              ...(email ? [{ 'members.email': email }] : []),
            ],
          });
        }

        if (org) {
          orgId = org._id ? org._id.toString() : null;
          orgName = org.name || orgName;

          const member = (org.members || []).find(
            (m: any) => String(m.userId) === String(userId) || (email && m.email === email),
          );
          if (member?.role) {
            detectedRole = String(member.role).toUpperCase();
          }
        }

        const contractsCol = this.connection.db.collection('contracts');
        const contractOrConditions: any[] = [];
        if (email) {
          contractOrConditions.push({ 'customer.contactEmail': email });
          contractOrConditions.push({ 'signingProcess.customerSigner.email': email });
        }
        if (userObjId) {
          contractOrConditions.push({ customerUserId: userObjId });
          contractOrConditions.push({ createdByUserId: userObjId });
          contractOrConditions.push({ customerUserId: userId });
          contractOrConditions.push({ createdByUserId: userId });
        }
        if (userOrgId) {
          if (Types.ObjectId.isValid(userOrgId)) {
            contractOrConditions.push({ organizationId: new Types.ObjectId(userOrgId) });
          }
          contractOrConditions.push({ organizationId: userOrgId.toString() });
        }
        if (org) {
          if (org._id) {
            contractOrConditions.push({ organizationId: org._id });
            contractOrConditions.push({ organizationId: org._id.toString() });
          }
          if (org.name) {
            contractOrConditions.push({ 'customer.companyName': org.name });
          }
        }

        const contracts = contractOrConditions.length > 0
          ? await contractsCol
              .find(
                { $or: contractOrConditions },
                {
                  projection: {
                    status: 1,
                    lifecycleStatus: 1,
                    activationStatus: 1,
                    serviceMode: 1,
                    contractType: 1,
                    contractNumber: 1,
                    endDate: 1,
                    'customer.contactEmail': 1,
                    'customer.companyName': 1,
                    'signingProcess.customerSigner.email': 1,
                    customerUserId: 1,
                    createdByUserId: 1,
                    organizationId: 1,
                    organizationName: 1,
                    createdAt: 1,
                  },
                },
              )
              .limit(20)
              .toArray()
          : [];

        contracts.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

        const activeContracts = contracts.filter(
          (c) =>
            c.status === 'ACTIVE' ||
            c.status === 'SIGNED' ||
            c.lifecycleStatus === 'COMPLETED' ||
            c.activationStatus === 'COMPLETED',
        );

        // Prioritize contract specifically assigned to or signed by this user
        const userSpecificActive = activeContracts.find(
          (c) =>
            (email && (
              c.customer?.contactEmail?.toLowerCase() === email ||
              c.signingProcess?.customerSigner?.email?.toLowerCase() === email
            )) ||
            (userObjId && (
              String(c.customerUserId) === String(userObjId) ||
              String(c.createdByUserId) === String(userObjId)
            ))
        );

        const primaryContract = userSpecificActive || activeContracts[0];

        if (primaryContract) {
          const rawMode = (primaryContract.serviceMode || primaryContract.contractType || '').toUpperCase();
          if (rawMode.includes('CONVERT') || rawMode.includes('MANAGED')) {
            serviceMode = 'WE_CONVERT_FOR_YOU';
          } else {
            serviceMode = 'SELF_SERVICE';
          }
          contractStatus = (primaryContract.status as any) || 'ACTIVE';
          contractNumber = primaryContract.contractNumber || null;
          if (primaryContract.organizationId && !orgId) {
            orgId = primaryContract.organizationId.toString();
          }
          if (primaryContract.customer?.companyName && orgName === 'Enterprise Organization') {
            orgName = primaryContract.customer.companyName;
          }
        } else if (contracts.length > 0) {
          const suspended = contracts.find(
            (c) => c.status === 'SUSPENDED' || c.lifecycleStatus === 'SUSPENDED',
          );
          const expired = contracts.find(
            (c) =>
              c.status === 'EXPIRED' ||
              (c.endDate && new Date(c.endDate) < new Date()),
          );
          const candidate = suspended || expired || contracts[0];
          const rawMode = (candidate.serviceMode || candidate.contractType || '').toUpperCase();
          if (rawMode.includes('CONVERT') || rawMode.includes('MANAGED')) {
            serviceMode = 'WE_CONVERT_FOR_YOU';
          } else {
            serviceMode = 'SELF_SERVICE';
          }
          if (suspended) {
            contractStatus = 'SUSPENDED';
            contractNumber = suspended.contractNumber || null;
          } else if (expired) {
            contractStatus = 'EXPIRED';
            contractNumber = expired.contractNumber || null;
          }
        } else if (org) {
          if (org.serviceMode === 'ALSM_MANAGED' || org.serviceMode === 'WE_CONVERT_FOR_YOU') {
            serviceMode = 'WE_CONVERT_FOR_YOU';
          } else {
            serviceMode = 'SELF_SERVICE';
          }
          contractStatus = org.status === 'ACTIVE' ? 'ACTIVE' : 'TRIAL';
        }
      } catch {
        // Fallback gracefully on query error
      }
    }

    return {
      organizationId: orgId,
      organizationName: orgName,
      serviceMode,
      contractType: serviceMode,
      contractStatus,
      contractNumber,
      role: detectedRole,
      permissions: userPermissions,
    };
  }

  async getUserNavigation(
    userId: string,
    app: ApplicationContext,
    options?: NavigationQueryOptions,
    userEmail?: string,
    precomputedContext?: AuthoritativeContractContext,
  ): Promise<NavNode[]> {
    let userPermissions = precomputedContext?.permissions || [];
    let userRoles: string[] = [];

    if (!precomputedContext) {
      const [perms, roles] = await Promise.all([
        this.effectivePermissionsService.getEffectivePermissions(userId),
        this.effectivePermissionsService.getUserRoles
          ? this.effectivePermissionsService.getUserRoles(userId)
          : Promise.resolve([]),
      ]);
      userPermissions = perms;
      userRoles = roles;
    }

    // Resolve authoritative contract & org context (reusing resolved permissions and roles)
    const contractContext =
      precomputedContext ||
      (await this.getAuthoritativeContractContext(
        userId,
        userPermissions,
        userRoles,
        userEmail,
      ));

    // Apply simulation options only for preview/admin simulation
    let effectiveServiceMode: string = contractContext.serviceMode;
    if (options?.contractType) {
      const ct = options.contractType.toUpperCase();
      if (ct === 'SELF_SERVICE' || ct === 'WE_CONVERT_FOR_YOU' || ct === 'HYBRID') {
        effectiveServiceMode = ct;
      }
    }

    let effectiveRole = contractContext.role;
    if (options?.role) {
      effectiveRole = options.role.toUpperCase();
    }

    const isEnterpriseLeader =
      effectiveRole === 'OWNER' ||
      effectiveRole === 'ORGANIZATION_OWNER' ||
      effectiveRole === 'ENTERPRISE_ADMIN' ||
      effectiveRole === 'PARTNER' ||
      effectiveRole === 'CUSTOMER' ||
      userRoles.includes('ADMIN') ||
      userRoles.includes('PARTNER') ||
      userRoles.includes('ENTERPRISE_ADMIN');

    const effectiveRolesList = Array.from(
      new Set([
        ...userRoles.map((r) => r.toUpperCase()),
        effectiveRole,
        ...(isEnterpriseLeader ? ['OWNER', 'ORGANIZATION_OWNER', 'ADMIN', 'ENTERPRISE_ADMIN', 'PARTNER'] : []),
      ]),
    );

    // Foundational permissions granted to any authenticated user in the portal
    const permissionsSet = new Set(userPermissions);
    permissionsSet.add('dashboard.view');
    permissionsSet.add('projects.view');
    permissionsSet.add('contracts.view');
    permissionsSet.add('service_usage.view');
    permissionsSet.add('meetings.view');
    permissionsSet.add('users.view');

    // Capabilities Engine: Strictly for WEB_3 (Enterprise Portal)
    const isWeb3 = app === ApplicationContext.WEB_3;
    const userCapabilities = isWeb3
      ? this.computeUserCapabilities(
          effectiveRole,
          effectiveServiceMode as any,
          contractContext.contractStatus,
          userRoles.includes('ADMIN') || isEnterpriseLeader,
        )
      : null;

    const menuItems = await this.navigationRepo.findActiveVisibleMenuItems(app);
    const itemIds = menuItems.map((m) => m.id);

    const itemPermsMap = await this.navigationRepo.findMenuItemPermissionsByItemIds(itemIds);

    const permittedItems: NavNode[] = [];

    for (const item of menuItems) {
      // 1. Contract Type Filtering (Strict 2 Types: Platform-Based vs Managed Modernization)
      const vis = (item.contractTypeVisibility || 'ALL').toUpperCase();
      let contractMatches = true;
      if (vis === 'ALL') {
        contractMatches = true;
      } else if (vis === 'SELF_SERVICE') {
        contractMatches = effectiveServiceMode === 'SELF_SERVICE' || effectiveServiceMode === 'HYBRID';
      } else if (vis === 'WE_CONVERT_FOR_YOU' || vis === 'MANAGED') {
        contractMatches = effectiveServiceMode === 'WE_CONVERT_FOR_YOU' || effectiveServiceMode === 'HYBRID';
      } else if (vis === 'HYBRID') {
        contractMatches = effectiveServiceMode === 'HYBRID';
      }

      if (!contractMatches) continue;

      // 2. Contract Status Restriction (Suspended / Expired)
      if (
        contractContext.contractStatus === 'SUSPENDED' ||
        contractContext.contractStatus === 'EXPIRED'
      ) {
        const route = item.route || '';
        const isSafeRoute =
          route.includes('/billing') ||
          route.includes('/contract') ||
          route.includes('/contact') ||
          route.includes('/docs') ||
          route.includes('/account') ||
          item.type === 'GROUP';
        if (!isSafeRoute) continue;
      }

      // 3. Capability / Permission Matching (Backend Authority)
      const required = itemPermsMap.get(item.id) || [];
      if (isWeb3) {
        if (item.capability) {
          if (!userCapabilities?.has(item.capability)) {
            continue;
          }
        } else {
          if (!this.warnedMissingCapabilityKeys.has(item.key)) {
            this.warnedMissingCapabilityKeys.add(item.key);
            this.logger.warn(`[WEB_3] Menu item ${item.key} (${item.id}) has no capability assigned`);
          }
          const isPermitted =
            required.length === 0 || required.every((req) => permissionsSet.has(req));
          if (!isPermitted) continue;
        }
      } else {
        // WEB_1 and WEB_2: Preserve original behavior (Pure Permission & Role filtering, NO capability resolution, NO warning log)
        const isPermitted =
          required.length === 0 || required.every((req) => permissionsSet.has(req));
        if (!isPermitted) continue;
      }

      // 4. Role Matching (if requiredRoles specified)
      if (item.requiredRoles && item.requiredRoles.length > 0) {
        const itemRolesUpper = item.requiredRoles.map((r) => r.toUpperCase());
        const hasRole = effectiveRolesList.some((ur) => itemRolesUpper.includes(ur));
        if (!hasRole) continue;
      }

      permittedItems.push({
        id: item.id,
        key: item.key,
        application: item.application,
        label: item.label,
        type: item.type,
        icon: item.icon,
        route: item.route,
        parentId: item.parentId,
        order: item.order,
        visibility: item.visibility,
        status: item.status,
        requiredPermissions: required,
        openInNewTab: item.openInNewTab ?? false,
        hideParentLabel: item.hideParentLabel ?? false,
        contractTypeVisibility: item.contractTypeVisibility || 'ALL',
        featureKey: item.featureKey || null,
        description: item.description || null,
        requiredRoles: item.requiredRoles || [],
        capability: item.capability || undefined,
      });
    }

    const tree = this.buildTree(permittedItems);

    // Safe fallback if empty
    if (tree.length === 0) {
      return [
        {
          id: 'default_dashboard',
          key: 'dashboard',
          application: app,
          label: app === ApplicationContext.WEB_3 ? 'Partner Dashboard' : 'Dashboard',
          type: 'PAGE',
          icon: 'LayoutDashboard',
          route: app === ApplicationContext.WEB_3 ? '/dashboard' : '/',
          parentId: null,
          order: 1,
          visibility: true,
          status: 'ACTIVE',
          requiredPermissions: [],
          openInNewTab: false,
          children: [],
        },
      ];
    }

    return tree;
  }

  private buildTree(nodes: NavNode[]): NavNode[] {
    const nodeMap = new Map<string, NavNode>();
    const roots: NavNode[] = [];

    for (const node of nodes) {
      nodeMap.set(node.id, { ...node, children: [] });
    }

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (items: NavNode[]) => {
      items.sort((a, b) => a.order - b.order);
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          sortNodes(item.children);
        }
      }
    };

    sortNodes(roots);

    const pruneEmptyGroups = (items: NavNode[]): NavNode[] => {
      return items.filter((item) => {
        if (item.children && item.children.length > 0) {
          item.children = pruneEmptyGroups(item.children);
        }
        const hasNoNavigablePage = !item.route || item.route.trim() === '' || item.type === 'GROUP';
        if (hasNoNavigablePage && (!item.children || item.children.length === 0)) {
          return false;
        }
        return true;
      });
    };

    const pruned = pruneEmptyGroups(roots);

    const applyHideParentLabel = (items: NavNode[]): NavNode[] => {
      const result: NavNode[] = [];
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          item.children = applyHideParentLabel(item.children);
        }
        if (item.type === 'GROUP' && item.hideParentLabel && item.children && item.children.length > 0) {
          for (const child of item.children) {
            result.push(child);
          }
        } else {
          result.push(item);
        }
      }
      return result;
    };

    return applyHideParentLabel(pruned);
  }

  /**
   * Enterprise Bootstrap (Big Tech pattern used by Salesforce, Stripe, Atlassian).
   * Resolves User, Organization, Active Contract, Quotas, and Computed Capabilities
   * in a single fail-closed endpoint with Stale-While-Revalidate caching.
   */
  async getSessionBootstrap(userId: string, email?: string): Promise<SessionBootstrapPayload> {
    if (this.bootstrapCache) {
      const cached = this.bootstrapCache.getByUserId(userId);
      if (cached) {
        if (cached.isStale) {
          void this.computeSessionBootstrap(userId, email).then((fresh) => {
            this.bootstrapCache?.set(
              userId,
              fresh.organization?.id || null,
              fresh.contract?.contractNumber || null,
              fresh,
            );
          }).catch(() => {});
        }
        return cached.data;
      }
    }

    const contractContext = await this.getAuthoritativeContractContext(userId, undefined, undefined, email);

    if (this.bootstrapCache) {
      const cached = this.bootstrapCache.get(userId, contractContext.organizationId, contractContext.contractNumber);
      if (cached) {
        if (cached.isStale) {
          void this.computeSessionBootstrap(userId, email, contractContext).then((fresh) => {
            this.bootstrapCache?.set(userId, contractContext.organizationId, contractContext.contractNumber, fresh);
          }).catch(() => {});
        }
        return cached.data;
      }
    }

    const payload = await this.computeSessionBootstrap(userId, email, contractContext);
    this.bootstrapCache?.set(userId, contractContext.organizationId, contractContext.contractNumber, payload);
    return payload;
  }

  invalidateBootstrapCache(userId?: string, orgId?: string, contractId?: string): void {
    this.bootstrapCache?.invalidate(userId, orgId, contractId);
  }

  private async computeSessionBootstrap(
    userId: string,
    email?: string,
    precomputedContext?: AuthoritativeContractContext,
  ): Promise<SessionBootstrapPayload> {
    const contractContext = precomputedContext || (await this.getAuthoritativeContractContext(userId, undefined, undefined, email));

    let userFullName = 'Enterprise User';
    let userAvatarUrl: string | undefined = undefined;
    let userEmail = email || '';
    let userDocRole = '';
    let isPlatformAdmin = false;
    let orgTier = 'ENTERPRISE';
    let orgStatus = 'ACTIVE';
    let orgSlug: string | undefined = undefined;
    let validUntil: string | null = null;
    let screensLimit = 1000;
    let screensUsed = 0;
    let storageLimitMb = 10240;
    let storageUsedMb = 120;
    let conversionsMonthlyLimit = 500;
    let conversionsUsed = 0;

    if (this.connection?.db) {
      try {
        const userObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
        const usersCol = this.connection.db.collection('users');
        const userDoc = await usersCol.findOne({
          $or: [
            ...(userObjId ? [{ _id: userObjId }] : []),
            { _id: userId as any },
          ],
        });

        if (userDoc) {
          userEmail = (userDoc.email || userEmail).toLowerCase().trim();
          userFullName = userDoc.fullName || userDoc.name || userFullName;
          userAvatarUrl = userDoc.avatarUrl;
          if (userDoc.role) userDocRole = String(userDoc.role).toUpperCase();
          isPlatformAdmin = Boolean(userDoc.isPlatformAdmin);
        }

        if (contractContext.organizationId) {
          const orgObjId = Types.ObjectId.isValid(contractContext.organizationId) ? new Types.ObjectId(contractContext.organizationId) : null;
          const orgsCol = this.connection.db.collection('organizations');
          const orgDoc = await orgsCol.findOne({
            $or: [
              ...(orgObjId ? [{ _id: orgObjId }] : []),
              { _id: contractContext.organizationId as any },
            ],
          });
          if (orgDoc) {
            orgTier = orgDoc.tier || orgDoc.type || orgTier;
            orgStatus = orgDoc.status || orgStatus;
            orgSlug = orgDoc.slug;
            if (orgDoc.screenCapacity) screensLimit = orgDoc.screenCapacity;
            if (orgDoc.screenUsage) screensUsed = orgDoc.screenUsage;
          }
        }

        if (contractContext.contractNumber) {
          const contractsCol = this.connection.db.collection('contracts');
          const contractDoc = await contractsCol.findOne(
            { contractNumber: contractContext.contractNumber },
            { projection: { endDate: 1, screenLimit: 1, conversionsLimit: 1 } },
          );
          if (contractDoc) {
            if (contractDoc.endDate) validUntil = new Date(contractDoc.endDate).toISOString();
            if (contractDoc.screenLimit) screensLimit = contractDoc.screenLimit;
            if (contractDoc.conversionsLimit) conversionsMonthlyLimit = contractDoc.conversionsLimit;
          }
        }

        const projectsCol = this.connection.db.collection('projects');
        const projectQuery: any = {};
        if (contractContext.organizationId) {
          projectQuery.organizationId = contractContext.organizationId;
        } else {
          projectQuery.ownerId = userId;
        }
        const projectDocs = await projectsCol.find(projectQuery, { projection: { screenCount: 1, conversionsCount: 1 } }).limit(50).toArray();
        if (projectDocs.length > 0) {
          screensUsed = projectDocs.reduce((acc, p) => acc + (p.screenCount || 0), 0);
          conversionsUsed = projectDocs.reduce((acc, p) => acc + (p.conversionsCount || 0), 0);
        }
      } catch {
        // Fallback safely to defaults on DB error
      }
    }

    const isReadOnly = contractContext.contractStatus === 'SUSPENDED' || contractContext.contractStatus === 'EXPIRED';
    const roleUpper = (userDocRole || contractContext.role || 'MEMBER').toUpperCase();
    const isViewer = roleUpper === 'VIEWER';
    const isAdmin =
      roleUpper === 'ADMIN' ||
      roleUpper === 'ENTERPRISE_ADMIN' ||
      roleUpper === 'ORGANIZATION_OWNER' ||
      roleUpper === 'OWNER' ||
      roleUpper === 'PARTNER' ||
      roleUpper === 'CUSTOMER' ||
      isPlatformAdmin;

    // Capabilities Engine: Shared Single Authoritative Engine
    const caps = this.computeUserCapabilities(
      userDocRole || contractContext.role,
      contractContext.serviceMode,
      contractContext.contractStatus,
      isPlatformAdmin,
    );

    const hasSelfService = contractContext.serviceMode === 'SELF_SERVICE' || contractContext.serviceMode === 'HYBRID';
    const hasManaged = contractContext.serviceMode === 'WE_CONVERT_FOR_YOU' || contractContext.serviceMode === 'HYBRID';

    const featureFlags: Record<string, boolean> = {
      enableAstWorkbench: hasSelfService,
      enableDeliverableSignoff: hasManaged,
      enableAdvancedAnalytics: isAdmin,
      enableCobolAnalysis: true,
      enableRealTimeStatus: true,
    };

    let navigationTree: NavNode[] = [];
    try {
      navigationTree = await this.getUserNavigation(
        userId,
        ApplicationContext.WEB_3,
        undefined,
        userEmail,
        contractContext,
      );
    } catch {
      navigationTree = [];
    }

    return {
      user: {
        id: userId,
        email: userEmail,
        fullName: userFullName,
        avatarUrl: userAvatarUrl,
        role: roleUpper,
        orgRole: contractContext.role,
        isPlatformAdmin,
      },
      organization: {
        id: contractContext.organizationId,
        name: contractContext.organizationName,
        tier: orgTier,
        status: orgStatus,
        slug: orgSlug,
      },
      contract: {
        id: contractContext.contractNumber,
        contractNumber: contractContext.contractNumber,
        serviceMode: contractContext.serviceMode,
        status: contractContext.contractStatus,
        validUntil,
        isReadOnly,
      },
      capabilities: Array.from(caps),
      quotas: {
        screensLimit,
        screensUsed,
        storageLimitMb,
        storageUsedMb,
        conversionsMonthlyLimit,
        conversionsUsed,
      },
      featureFlags,
      navigationTree,
      sourceTimestamp: new Date().toISOString(),
    };
  }
}
