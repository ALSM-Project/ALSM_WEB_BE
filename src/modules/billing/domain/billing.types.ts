/** Billing domain types – enums, interfaces, repository tokens. */

// ─── Plan Tier ──────────────────────────────────────────────
export enum PlanTier {
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

// ─── Billing Cycle ──────────────────────────────────────────
export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

// ─── Subscription Status ────────────────────────────────────
export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
}

// ─── Invoice Status ─────────────────────────────────────────
export enum InvoiceStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ─── Payment Status ─────────────────────────────────────────
export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

// ─── Subscription Plan definition ───────────────────────────
export interface SubscriptionPlanDefinition {
  tier: PlanTier;
  name: string;
  description: string;
  monthlyPriceVnd: number;
  annualPriceVnd: number;
  isPopular: boolean;
  maxProjects: number;       // -1 = unlimited
  maxScreensPerMonth: number; // -1 = unlimited
  storageGb: number;         // -1 = unlimited
  features: string[];
}

/** Static plan catalogue – single source of truth. */
export const PLAN_CATALOGUE: SubscriptionPlanDefinition[] = [
  {
    tier: PlanTier.STARTER,
    name: 'Starter',
    description: 'Essential tools for small teams modernizing single applications.',
    monthlyPriceVnd: 99_000,
    annualPriceVnd: 79_000,
    isPopular: false,
    maxProjects: 1,
    maxScreensPerMonth: 10,
    storageGb: 5,
    features: [
      '1 Project',
      '10 Screens per month',
      '5GB Storage',
      'Basic UI token export',
      'Community support',
    ],
  },
  {
    tier: PlanTier.PROFESSIONAL,
    name: 'Professional',
    description: 'Advanced AI capabilities for high-velocity engineering workflows.',
    monthlyPriceVnd: 499_000,
    annualPriceVnd: 399_000,
    isPopular: true,
    maxProjects: -1,
    maxScreensPerMonth: 100,
    storageGb: 50,
    features: [
      'Unlimited Projects',
      '100 Screens per month',
      '50GB Storage',
      'AI-assisted structural mapping',
      'Code review workflow',
      'Priority email support',
    ],
  },
  {
    tier: PlanTier.ENTERPRISE,
    name: 'Enterprise',
    description: 'Custom deployment and maximum security for large organizations.',
    monthlyPriceVnd: 0,
    annualPriceVnd: 0,
    isPopular: false,
    maxProjects: -1,
    maxScreensPerMonth: -1,
    storageGb: -1,
    features: [
      'Unlimited screens & storage',
      'Dedicated CSM',
      'SSO/SAML Integration',
      'On-premise deployment option',
      'Custom AI model training',
      '99.9% Uptime SLA',
    ],
  },
];

// ─── Casso Transaction & VietQR Config ─────────────────────
export interface CassoTransaction {
  id: number;
  tid: string;
  description: string;
  amount: number;
  cusum_balance: number;
  when: string;
  bank_sub_acc_id: string;
}

export const DEFAULT_BANK_CONFIG = {
  bankId: 'MB',
  bankName: 'MBBank (Ngan hang Quan doi)',
  accountNumber: '0899886249',
  accountName: 'CONG TY COPHAN ALSM SOFTWARE',
};
export const VIETQR_BANK_CONFIG = DEFAULT_BANK_CONFIG;

// ─── Repository injection tokens ────────────────────────────
export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

