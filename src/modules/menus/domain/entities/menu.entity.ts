import { IMenuItem } from '../value-objects/menu-item.vo';

export interface MenuProps {
  id: string;
  role: string;
  isDefault: boolean;
  items: IMenuItem[];
  createdBy?: string;
  createdAt: Date;
  updatedBy?: string;
  updatedAt: Date;
}

export class MenuEntity {
  constructor(private readonly props: MenuProps) {}

  getId(): string {
    return this.props.id;
  }

  getRole(): string {
    return this.props.role;
  }

  isDefault(): boolean {
    return this.props.isDefault;
  }

  getItems(): IMenuItem[] {
    return this.props.items || [];
  }

  toProps(): MenuProps {
    return { ...this.props };
  }
}
