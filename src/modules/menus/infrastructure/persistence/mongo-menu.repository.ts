import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuEntity, MenuProps } from '../../domain/entities/menu.entity';
import { IMenuRepository } from '../../domain/interfaces/menu.repository.interface';
import { MenuMapper } from '../mapper/menu.mapper';
import { Menu, MenuDocument } from '../schemas/menu.schema';

@Injectable()
export class MongoMenuRepository implements IMenuRepository {
  constructor(
    @InjectModel(Menu.name)
    private readonly menuModel: Model<MenuDocument>,
  ) {}

  async findByRole(role: string): Promise<MenuEntity | null> {
    const doc = await this.menuModel.findOne({ role }).exec();
    if (!doc) {
      // Fallback to default menu if role-specific menu is missing
      const defaultDoc = await this.menuModel.findOne({ isDefault: true }).exec();
      return MenuMapper.toDomain(defaultDoc);
    }
    return MenuMapper.toDomain(doc);
  }

  async createOrUpdateMenu(props: MenuProps): Promise<MenuEntity> {
    const doc = await this.menuModel
      .findOneAndUpdate(
        { role: props.role },
        {
          role: props.role,
          isDefault: props.isDefault,
          items: props.items,
          createdBy: props.createdBy,
          updatedBy: props.updatedBy,
        },
        { upsert: true, new: true },
      )
      .exec();
    return MenuMapper.toDomain(doc)!;
  }

  async findAll(): Promise<MenuEntity[]> {
    const docs = await this.menuModel.find().exec();
    return docs.map(d => MenuMapper.toDomain(d)!).filter(Boolean);
  }
}
