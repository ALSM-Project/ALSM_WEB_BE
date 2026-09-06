import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IPlanRepository, PlanProps } from '../../domain/billing.repository.interface';
import { PlanTier } from '../../domain/billing.types';
import { Plan, PlanDocument } from '../plan.schema';

@Injectable()
export class MongoPlanRepository implements IPlanRepository {
  constructor(
    @InjectModel(Plan.name)
    private readonly model: Model<PlanDocument>,
  ) {}

  private toDomain(doc: PlanDocument): PlanProps {
    return {
      id: doc._id.toString(),
      tier: doc.tier,
      name: doc.name,
      description: doc.description,
      monthlyPriceVnd: doc.monthlyPriceVnd,
      annualPriceVnd: doc.annualPriceVnd,
      isPopular: doc.isPopular,
      maxProjects: doc.maxProjects,
      maxScreensPerMonth: doc.maxScreensPerMonth,
      storageGb: doc.storageGb,
      features: doc.features,
      sortOrder: doc.sortOrder,
      isActive: doc.isActive,
    };
  }

  async findAllActive(): Promise<PlanProps[]> {
    const docs = await this.model
      .find({ isActive: { $ne: false } })
      .sort({ sortOrder: 1, monthlyPriceVnd: 1 })
      .exec();
    return docs.map((d) => this.toDomain(d));
  }

  async findByTier(tier: PlanTier): Promise<PlanProps | null> {
    const doc = await this.model.findOne({ tier }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async seedDefaults(defaults: PlanProps[]): Promise<void> {
    const count = await this.model.countDocuments().exec();
    if (count === 0) {
      const docsToInsert = defaults.map((d, index) => ({
        tier: d.tier,
        name: d.name,
        description: d.description,
        monthlyPriceVnd: d.monthlyPriceVnd,
        annualPriceVnd: d.annualPriceVnd,
        isPopular: d.isPopular,
        maxProjects: d.maxProjects,
        maxScreensPerMonth: d.maxScreensPerMonth,
        storageGb: d.storageGb,
        features: d.features,
        sortOrder: index + 1,
        isActive: true,
      }));
      await this.model.insertMany(docsToInsert);
    }
  }

  async createOrUpdate(plan: Omit<PlanProps, 'id'>): Promise<PlanProps> {
    const doc = await this.model
      .findOneAndUpdate(
        { tier: plan.tier },
        { $set: plan },
        { new: true, upsert: true },
      )
      .exec();
    return this.toDomain(doc);
  }
}
