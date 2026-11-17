/**
 * Single Authoritative Capability Registry (Big Tech Entitlements + Capabilities Pattern).
 *
 * All frontend routes, menu items, and backend authorization rules reference this registry.
 * Capabilities are computed dynamically per session by combining:
 * 1. Role Grants
 * 2. Plan Entitlements (Service Mode: Self-Service vs Managed Modernization)
 * 3. Contract Lifecycle Status (Active, Suspended, Expired)
 */

export interface CapabilityDefinition {
  key: string;
  label: string;
  category: 'CORE' | 'ORGANIZATION' | 'MANAGED' | 'SELF_SERVICE' | 'GOVERNANCE';
  description: string;
}

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  // 1. CORE / BASE
  { key: 'dashboard.view', label: 'View Dashboard', category: 'CORE', description: 'Access baseline workspace dashboard' },
  { key: 'project.view', label: 'View Projects', category: 'CORE', description: 'View modernization project portfolios' },
  { key: 'project.files.view', label: 'View Project Files', category: 'CORE', description: 'Browse and inspect project source files' },
  { key: 'contract.view', label: 'View Contracts', category: 'CORE', description: 'Inspect legally binding enterprise contracts' },
  { key: 'invoice.view', label: 'View Invoices', category: 'CORE', description: 'View billing statements and invoices' },
  { key: 'service_usage.view', label: 'View Service Usage', category: 'CORE', description: 'Monitor screen conversion quotas & consumption' },
  { key: 'meeting.view', label: 'View Meetings', category: 'CORE', description: 'Access meeting schedules & online rooms' },
  { key: 'meeting.schedule', label: 'Schedule Meetings', category: 'CORE', description: 'Book consultation / technical sync meetings' },
  { key: 'conversations.view', label: 'View Conversations', category: 'CORE', description: 'Participate in team and modernizer messaging' },
  { key: 'conversations.create', label: 'Send Messages', category: 'CORE', description: 'Send chat messages and replies' },
  { key: 'account.manage', label: 'Manage Account Profile', category: 'CORE', description: 'Update profile and user preferences' },
  { key: 'account.security', label: 'Manage Security & 2FA', category: 'CORE', description: 'Manage passwords, active sessions, and 2FA' },

  // 2. ORGANIZATION
  { key: 'organization.view', label: 'View Organization Profile', category: 'ORGANIZATION', description: 'Inspect company and enterprise profile' },
  { key: 'organization.profile.view', label: 'View Profile Details', category: 'ORGANIZATION', description: 'Detailed legal entity details' },
  { key: 'organization.profile.update', label: 'Update Legal Profile', category: 'ORGANIZATION', description: 'Edit company legal information' },
  { key: 'organization.members.view', label: 'View Team Members', category: 'ORGANIZATION', description: 'Inspect organization member roster' },
  { key: 'organization.members.invite', label: 'Invite Members', category: 'ORGANIZATION', description: 'Invite new coworkers to organization' },
  { key: 'organization.members.manage', label: 'Manage Memberships', category: 'ORGANIZATION', description: 'Change roles, suspend, or remove members' },
  { key: 'organization.teams.view', label: 'View Internal Teams', category: 'ORGANIZATION', description: 'Inspect internal teams & squads' },
  { key: 'organization.teams.manage', label: 'Manage Internal Teams', category: 'ORGANIZATION', description: 'Create, update, and manage squads' },
  { key: 'organization.roles.manage', label: 'Manage Roles & RBAC', category: 'ORGANIZATION', description: 'Configure permissions and custom roles' },
  { key: 'organization.analytics.view', label: 'View Analytics', category: 'ORGANIZATION', description: 'Access enterprise modernization metrics' },
  { key: 'organization.audit.view', label: 'View Audit Logs', category: 'ORGANIZATION', description: 'Inspect administrative audit trails' },

  // 3. MANAGED MODERNIZATION (Turnkey Services)
  { key: 'dashboard.managed', label: 'Managed Services Dashboard', category: 'MANAGED', description: 'Access turnkey delivery dashboard' },
  { key: 'deliverable.view', label: 'View Deliverables', category: 'MANAGED', description: 'Inspect completed code packages & SOW milestones' },
  { key: 'deliverable.download', label: 'Download Deliverables', category: 'MANAGED', description: 'Download verified code packages' },
  { key: 'deliverable.signoff', label: 'Sign-Off Deliverables', category: 'MANAGED', description: 'Approve and sign off on project deliverables' },
  { key: 'conversion_request.view', label: 'View Conversion Requests', category: 'MANAGED', description: 'Track turnkey conversion orders' },
  { key: 'conversion_request.create', label: 'Submit Conversion Request', category: 'MANAGED', description: 'Request dedicated modernizer conversion' },
  { key: 'project.files.upload', label: 'Upload Project Source', category: 'MANAGED', description: 'Upload legacy sources for turnkey modernization' },

  // 4. SELF-SERVICE MODERNIZATION
  { key: 'dashboard.self_service', label: 'Self-Service Dashboard', category: 'SELF_SERVICE', description: 'Access developer automated conversion dashboard' },
  { key: 'project.create', label: 'Create Project', category: 'SELF_SERVICE', description: 'Initialize self-service modernization project' },
  { key: 'project.delete', label: 'Delete Project', category: 'SELF_SERVICE', description: 'Delete modernization project' },
  { key: 'screen.view', label: 'View Screens', category: 'SELF_SERVICE', description: 'Browse and filter legacy screens' },
  { key: 'screen.inspect', label: 'Inspect Screen AST', category: 'SELF_SERVICE', description: 'Deep syntax and AST examination' },
  { key: 'screen.upload', label: 'Upload Screen Files', category: 'SELF_SERVICE', description: 'Upload BMS, DSPF, or COBOL source' },
  { key: 'screen.convert', label: 'Execute Screen Conversion', category: 'SELF_SERVICE', description: 'Run single-screen conversion engine' },
  { key: 'code.bulk_convert', label: 'Execute Bulk Conversion', category: 'SELF_SERVICE', description: 'Batch process multiple legacy screens' },
  { key: 'preview.studio', label: 'Preview Studio', category: 'SELF_SERVICE', description: 'Interactive React live preview' },
  { key: 'version_history.view', label: 'Version History', category: 'SELF_SERVICE', description: 'Compare revisions and previous AST outputs' },
  { key: 'field_mapping.edit', label: 'Edit Field Mappings', category: 'SELF_SERVICE', description: 'Customize screen-to-component mappings' },
  { key: 'method_mapping.edit', label: 'Edit Method Mappings', category: 'SELF_SERVICE', description: 'Configure backend procedure bindings' },
  { key: 'quality_review.view', label: 'View Quality Review', category: 'SELF_SERVICE', description: 'Inspect AST conversion diagnostics' },
  { key: 'quality_review.submit', label: 'Submit Quality Review', category: 'SELF_SERVICE', description: 'Complete quality gate and approvals' },
  { key: 'code.export', label: 'Export Converted Code', category: 'SELF_SERVICE', description: 'Download React/Java modernization bundle' },

  // 5. GOVERNANCE
  { key: 'contract.is_read_only', label: 'Read-Only Contract State', category: 'GOVERNANCE', description: 'System flag when contract is suspended or expired' },
];

export const VALID_CAPABILITY_KEYS = new Set(CAPABILITY_REGISTRY.map((c) => c.key));

export function isValidCapability(key: string): boolean {
  return VALID_CAPABILITY_KEYS.has(key);
}
