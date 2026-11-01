import 'reflect-metadata';
import { DynamicModule } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { PlatformAdminController } from '../src/modules/admin/presentation/platform-admin.controller';
import { SupportPatchController } from '../src/modules/conversions/presentation/support-patch.controller';
import { SupportFoundationModule } from '../src/modules/support/support-foundation.module';
import { SupportContextController } from '../src/modules/support/presentation/support-context.controller';
import { SupportStaffAuthorityModule } from '../src/modules/rbac/support-staff-authority.module';
import { SupportOrganizationDirectoryModule } from '../src/modules/organizations/support-organization-directory.module';
import { SupportWorkspaceController } from '../src/modules/support/presentation/support-workspace.controller';

describe('UC-66 production activation stays closed', () => {
  const modules = new Set<unknown>(),
    controllers = new Set<unknown>(),
    tokens = new Set<string>();

  beforeAll(async () => {
    // Read actual production Nest metadata without loading .env or opening external services.
    const config = jest.spyOn(ConfigModule, 'forRoot').mockResolvedValue({ module: ConfigModule });
    try {
      const { AppModule } = await import('../src/app.module');
      async function inspect(value: unknown): Promise<void> {
        const entry = await value;
        if (!entry) return;
        const dynamic = entry as Partial<DynamicModule>;
        const type = dynamic.module ?? entry;
        if (typeof type !== 'function') return;
        for (const controller of dynamic.controllers ?? []) controllers.add(controller);
        for (const provider of dynamic.providers ?? [])
          tokens.add(String(typeof provider === 'function' ? provider.name : provider.provide));
        for (const child of dynamic.imports ?? []) await inspect(child);
        if (modules.has(type)) return;
        modules.add(type);
        for (const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, type) ?? [])
          controllers.add(controller);
        for (const provider of Reflect.getMetadata(MODULE_METADATA.PROVIDERS, type) ?? [])
          tokens.add(String(typeof provider === 'function' ? provider.name : provider.provide));
        for (const child of Reflect.getMetadata(MODULE_METADATA.IMPORTS, type) ?? [])
          await inspect(child);
      }
      await inspect(AppModule);
    } finally {
      config.mockRestore();
    }
  });

  it('registers none of the foundation controllers, models or support readers', () => {
    expect(modules.has(SupportFoundationModule)).toBe(false);
    expect(modules.has(SupportStaffAuthorityModule)).toBe(false);
    expect(modules.has(SupportOrganizationDirectoryModule)).toBe(false);
    expect(controllers.has(SupportContextController)).toBe(false);
    expect(controllers.has(SupportWorkspaceController)).toBe(false);
    expect(
      [...tokens].some((token) =>
        /SupportContext|SupportWorkspace|SUPPORT_.*READER|SUPPORT_STAFF_AUTHORITY|SUPPORT_ORGANIZATION_DIRECTORY/.test(
          token,
        ),
      ),
    ).toBe(false);
    expect(
      [...controllers].some((controller) =>
        /support-tickets|support\/organizations/.test(
          Reflect.getMetadata(PATH_METADATA, controller as object) ?? '',
        ),
      ),
    ).toBe(false);
  });

  it('preserves the existing disabled impersonation route and independent UC-67 controller', () => {
    expect(controllers.has(PlatformAdminController)).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, PlatformAdminController.prototype.impersonate)).toBe(
      'organizations/:id/impersonate',
    );
    expect(controllers.has(SupportPatchController)).toBe(true);
  });
});
