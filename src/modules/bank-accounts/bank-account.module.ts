import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BankAccount, BankAccountSchema } from './infrastructure/schemas/bank-account.schema';
import { BankAccountEncryptionService } from './infrastructure/bank-account-encryption.service';
import { BankAccountService } from './application/services/bank-account.service';
import { BankAccountController } from './presentation/controllers/bank-account.controller';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BankAccount.name, schema: BankAccountSchema },
    ]),
    RbacModule,
  ],
  providers: [
    BankAccountEncryptionService,
    BankAccountService,
  ],
  controllers: [
    BankAccountController,
  ],
  exports: [
    BankAccountService,
    BankAccountEncryptionService,
  ],
})
export class BankAccountModule {}
