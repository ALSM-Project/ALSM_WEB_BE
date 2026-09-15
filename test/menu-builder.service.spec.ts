import { BadRequestException } from '@nestjs/common';
import { MenuBuilderService } from '../src/modules/menus/application/services/menu-builder.service';
import { IMenuBuilderRepository } from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../src/modules/menus/domain/enums/menu.enums';

describe('MenuBuilderService Hierarchy & Integrity Rules', () => {
  it('rejects deletion of a parent menu item that has children with exact error message', async () => {
    const mockRepo: Partial<IMenuBuilderRepository> = {
      findMenuItemById: jest.fn().mockResolvedValue({
        id: 'parent-1',
        key: 'parent-1',
        application: ApplicationContext.WEB_2,
        label: 'Parent',
        type: MenuItemType.PAGE,
        icon: 'Folder',
        route: null,
        parentId: null,
        order: 0,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      }),
      countChildren: jest.fn().mockResolvedValue(2), // 2 children exist
    };

    const service = new MenuBuilderService(mockRepo as IMenuBuilderRepository);

    await expect(service.deleteMenuItem('parent-1')).rejects.toThrow(BadRequestException);
    await expect(service.deleteMenuItem('parent-1')).rejects.toMatchObject({
      response: {
        code: 'CANNOT_DELETE_PARENT',
        message: 'Cannot delete a menu item with children.',
      },
    });
  });

  it('prevents self-parenting', async () => {
    const mockRepo: Partial<IMenuBuilderRepository> = {
      findMenuItemById: jest.fn().mockResolvedValue({
        id: 'item-1',
        key: 'item-1',
        application: ApplicationContext.WEB_2,
        label: 'Item 1',
        type: MenuItemType.PAGE,
        icon: 'Folder',
        route: null,
        parentId: null,
        order: 0,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      }),
    };

    const service = new MenuBuilderService(mockRepo as IMenuBuilderRepository);

    await expect(
      service.updateMenuItem('item-1', { parentId: 'item-1' }),
    ).rejects.toThrow(BadRequestException);
  });
});
