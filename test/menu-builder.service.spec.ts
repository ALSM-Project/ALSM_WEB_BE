import { BadRequestException } from '@nestjs/common';
import { MenuBuilderService } from '../src/modules/menus/application/services/menu-builder.service';

describe('MenuBuilderService Hierarchy & Integrity Rules', () => {
  it('rejects deletion of a parent menu item that has children with exact error message', async () => {
    const menuItemModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'parent-1', label: 'Parent' }),
      }),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(2), // 2 children exist
      }),
    };

    const menuItemPermissionModel = {
      deleteMany: jest.fn(),
    };

    const service = new MenuBuilderService(
      menuItemModel as never,
      menuItemPermissionModel as never,
      {} as never,
    );

    await expect(service.deleteMenuItem('parent-1')).rejects.toThrow(BadRequestException);
    await expect(service.deleteMenuItem('parent-1')).rejects.toMatchObject({
      response: {
        code: 'CANNOT_DELETE_PARENT',
        message: 'Cannot delete a menu item with children.',
      },
    });
  });

  it('prevents self-parenting', async () => {
    const menuItemModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'item-1', label: 'Item 1' }),
      }),
    };

    const service = new MenuBuilderService(menuItemModel as never, {} as never, {} as never);

    await expect(
      service.updateMenuItem('item-1', { parentId: 'item-1' }),
    ).rejects.toThrow(BadRequestException);
  });
});

