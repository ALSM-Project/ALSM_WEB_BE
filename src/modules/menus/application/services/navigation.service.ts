import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { ApplicationContext } from '../../domain/enums/menu.enums';
import { EffectivePermissionsService } from '../../../rbac/application/effective-permissions.service';
import {
  INavigationRepository,
  NAVIGATION_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';

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
  constructor(
    @Inject(NAVIGATION_REPOSITORY)
    private readonly navigationRepo: INavigationRepository,
    private readonly effectivePermissionsService: EffectivePermissionsService,
    @Optional()
    @InjectConnection()
    private readonly connection?: Connection,
  ) {}

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
                    customer: 1,
                    signingProcess: 1,
                    customerUserId: 1,
                    createdByUserId: 1,
                    organizationId: 1,
                    organizationName: 1,
                    createdAt: 1,
                  },
                },
              )
              .sort({ createdAt: -1 })
              .toArray()
          : [];

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
  ): Promise<NavNode[]> {
    const [userPermissions, userRoles] = await Promise.all([
      this.effectivePermissionsService.getEffectivePermissions(userId),
      this.effectivePermissionsService.getUserRoles
        ? this.effectivePermissionsService.getUserRoles(userId)
        : Promise.resolve([]),
    ]);

    // Resolve authoritative contract & org context (reusing resolved permissions and roles)
    const contractContext = await this.getAuthoritativeContractContext(
      userId,
      userPermissions,
      userRoles,
      userEmail,
    );

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

    const effectiveRolesList = Array.from(
      new Set([...userRoles.map((r) => r.toUpperCase()), effectiveRole]),
    );

    // Foundational permissions granted to any authenticated user in the portal
    const permissionsSet = new Set(userPermissions);
    permissionsSet.add('dashboard.view');
    permissionsSet.add('projects.view');
    permissionsSet.add('contracts.view');
    permissionsSet.add('service_usage.view');
    permissionsSet.add('meetings.view');
    permissionsSet.add('users.view');

    // If user is Organization OWNER or ADMIN, add appropriate owner permissions
    if (effectiveRole === 'OWNER' || effectiveRole === 'ORGANIZATION_OWNER' || userRoles.includes('ADMIN')) {
      [
        'organization.view',
        'organization.update',
        'organization.members.view',
        'organization.members.invite',
        'organization.members.remove',
        'organization.roles.manage',
        'projects.view',
        'projects.create',
        'projects.update',
        'projects.delete',
        'projects.members.manage',
        'project_files.view',
        'project_files.upload',
        'project_files.download',
        'project_files.delete',
        'conversion.execute',
        'conversion.view',
        'conversion.history.view',
        'conversion.results.view',
        'conversion_requests.view',
        'conversion_requests.create',
        'conversion_requests.update',
        'conversion_requests.cancel',
        'project_progress.view',
        'project_deliverables.view',
        'project_deliverables.download',
        'service_usage.view',
        'quotas.view',
        'contracts.view',
        'contracts.upgrade.request',
        'conversations.view',
        'conversations.create',
        'meetings.view',
        'meetings.create',
        'support_requests.create',
        'partner_portal.dashboard.view',
        'partner_portal.project.view',
        'partner_portal.download',
      ].forEach((p) => permissionsSet.add(p));
    }

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
        contractMatches = effectiveServiceMode === 'SELF_SERVICE';
      } else if (vis === 'WE_CONVERT_FOR_YOU' || vis === 'MANAGED') {
        contractMatches = effectiveServiceMode === 'WE_CONVERT_FOR_YOU';
      } else if (vis === 'HYBRID') {
        contractMatches = false;
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

      // 3. Permission Matching
      const required = itemPermsMap.get(item.id) || [];
      const isPermitted =
        required.length === 0 || required.every((req) => permissionsSet.has(req));
      if (!isPermitted) continue;

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
}
