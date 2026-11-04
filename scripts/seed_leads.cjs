const mongoose = require('mongoose');
require('dotenv').config();

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Sample lead seeding is disabled in production');
  }
  if (process.env.ALLOW_SAMPLE_LEAD_SEED !== 'true') {
    throw new Error('Set ALLOW_SAMPLE_LEAD_SEED=true to explicitly seed sample leads');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI must be configured in the environment or .env file');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const currentCount = await db.collection('leads').countDocuments();
  if (currentCount > 0) {
    console.log(`Leads collection already has ${currentCount} records. Skipping seed.`);
    await mongoose.disconnect();
    return;
  }

  const sampleStaff = [
    { id: new mongoose.Types.ObjectId('6a8d90b0569ea93e27ad862c'), email: 'test.local@alsm.dev' },
    { id: new mongoose.Types.ObjectId('6a8d97ad0bc42a1a1700888e'), email: 'tranvantien.13081995.dmx@gmail.com' },
    { id: new mongoose.Types.ObjectId('6a8d9e020bc42a1a170088d0'), email: 'tranvantien13082004@gmail.com' },
  ];

  const leads = [
    {
      companyName: 'FinTech Dynamics Corp',
      contactName: 'Sarah Jenkins',
      contactEmail: 's.jenkins@fintechdynamics.com',
      contactPhone: '+1 (555) 234-5678',
      jobTitle: 'VP of Engineering',
      status: 'QUALIFIED',
      source: 'WEBSITE',
      priority: 'HIGH',
      estimatedValue: 120000,
      currency: 'USD',
      notes: 'Looking to modernize AS400 core banking screens to modern React cloud microservices. Budget approved for Q4.',
      assignedToUserId: sampleStaff[0].id,
      assignedToEmail: sampleStaff[0].email,
      tags: ['Banking', 'AS400', 'CloudMigration'],
      lastContactedAt: new Date(Date.now() - 2 * 86400000),
      nextFollowUpAt: new Date(Date.now() + 3 * 86400000),
      createdByUserId: sampleStaff[0].id,
      createdByEmail: sampleStaff[0].email,
      createdAt: new Date(Date.now() - 10 * 86400000),
      updatedAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      companyName: 'Apex Health Systems',
      contactName: 'Dr. Michael Chang',
      contactEmail: 'mchang@apexhealth.org',
      contactPhone: '+1 (555) 876-5432',
      jobTitle: 'Chief Medical Information Officer',
      status: 'NEW',
      source: 'REFERRAL',
      priority: 'CRITICAL',
      estimatedValue: 250000,
      currency: 'USD',
      notes: 'Needs HIPAA-compliant COBOL to Java backend migration for medical billing records. Urgent timeline.',
      assignedToUserId: sampleStaff[1].id,
      assignedToEmail: sampleStaff[1].email,
      tags: ['Healthcare', 'COBOL', 'HIPAA'],
      lastContactedAt: null,
      nextFollowUpAt: new Date(Date.now() + 1 * 86400000),
      createdByUserId: sampleStaff[1].id,
      createdByEmail: sampleStaff[1].email,
      createdAt: new Date(Date.now() - 1 * 86400000),
      updatedAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      companyName: 'Global Logistics Hub',
      contactName: 'Elena Rostova',
      contactEmail: 'elena.rostova@globallogistics.com',
      contactPhone: '+44 20 7946 0912',
      jobTitle: 'Head of Supply Chain Technology',
      status: 'PROPOSAL',
      source: 'TRADE_SHOW',
      priority: 'HIGH',
      estimatedValue: 85000,
      currency: 'USD',
      notes: 'Met at London Modernization Expo 2026. Proposal sent for 45 BMS screen conversion bundle.',
      assignedToUserId: sampleStaff[2].id,
      assignedToEmail: sampleStaff[2].email,
      tags: ['Logistics', 'BMS', 'Europe'],
      lastContactedAt: new Date(Date.now() - 1 * 86400000),
      nextFollowUpAt: new Date(Date.now() + 4 * 86400000),
      createdByUserId: sampleStaff[2].id,
      createdByEmail: sampleStaff[2].email,
      createdAt: new Date(Date.now() - 15 * 86400000),
      updatedAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      companyName: 'Pacific Retail Group',
      contactName: 'David Tanaka',
      contactEmail: 'd.tanaka@pacificretail.jp',
      contactPhone: '+81 3 5555 0143',
      jobTitle: 'Director of IT Operations',
      status: 'NEGOTIATION',
      source: 'PARTNER',
      priority: 'MEDIUM',
      estimatedValue: 180000,
      currency: 'USD',
      notes: 'Reviewing enterprise SLA and multi-tenant security architecture.',
      assignedToUserId: sampleStaff[0].id,
      assignedToEmail: sampleStaff[0].email,
      tags: ['Retail', 'Japan', 'EnterpriseSLA'],
      lastContactedAt: new Date(Date.now() - 3 * 86400000),
      nextFollowUpAt: new Date(Date.now() + 2 * 86400000),
      createdByUserId: sampleStaff[0].id,
      createdByEmail: sampleStaff[0].email,
      createdAt: new Date(Date.now() - 25 * 86400000),
      updatedAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      companyName: 'Summit Assurance Ltd',
      contactName: 'Victoria Hayes',
      contactEmail: 'vhayes@summitassurance.co.uk',
      contactPhone: '+44 20 7123 4567',
      jobTitle: 'Chief Technology Officer',
      status: 'WON',
      source: 'EMAIL_CAMPAIGN',
      priority: 'HIGH',
      estimatedValue: 320000,
      currency: 'USD',
      notes: 'Contract signed! Onboarding kick-off meeting scheduled with conversion engineering team.',
      assignedToUserId: sampleStaff[1].id,
      assignedToEmail: sampleStaff[1].email,
      tags: ['Insurance', 'ContractSigned', 'KeyAccount'],
      lastContactedAt: new Date(Date.now() - 4 * 86400000),
      nextFollowUpAt: null,
      createdByUserId: sampleStaff[1].id,
      createdByEmail: sampleStaff[1].email,
      createdAt: new Date(Date.now() - 40 * 86400000),
      updatedAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      companyName: 'Nordic Telecom AB',
      contactName: 'Lars Lindqvist',
      contactEmail: 'lars.l@nordictel.se',
      contactPhone: '+46 8 123 4567',
      jobTitle: 'Infrastructure Architect',
      status: 'CONTACTED',
      source: 'WEBSITE',
      priority: 'MEDIUM',
      estimatedValue: 65000,
      currency: 'USD',
      notes: 'Downloaded whitepaper on DSPF modern web translation. Had initial intro call.',
      assignedToUserId: sampleStaff[2].id,
      assignedToEmail: sampleStaff[2].email,
      tags: ['Telecom', 'Nordics', 'DSPF'],
      lastContactedAt: new Date(Date.now() - 5 * 86400000),
      nextFollowUpAt: new Date(Date.now() + 2 * 86400000),
      createdByUserId: sampleStaff[2].id,
      createdByEmail: sampleStaff[2].email,
      createdAt: new Date(Date.now() - 7 * 86400000),
      updatedAt: new Date(Date.now() - 5 * 86400000),
    },
    {
      companyName: 'AeroTech Manufacturing',
      contactName: 'Robert Vance',
      contactEmail: 'rvance@aerotechmfg.com',
      contactPhone: '+1 (555) 432-1098',
      jobTitle: 'Plant IT Manager',
      status: 'LOST',
      source: 'COLD_CALL',
      priority: 'LOW',
      estimatedValue: 40000,
      currency: 'USD',
      notes: 'Decided to postpone migration project until next fiscal year due to internal restructuring.',
      assignedToUserId: sampleStaff[0].id,
      assignedToEmail: sampleStaff[0].email,
      tags: ['Manufacturing', 'Postponed'],
      lastContactedAt: new Date(Date.now() - 20 * 86400000),
      nextFollowUpAt: null,
      createdByUserId: sampleStaff[0].id,
      createdByEmail: sampleStaff[0].email,
      createdAt: new Date(Date.now() - 50 * 86400000),
      updatedAt: new Date(Date.now() - 20 * 86400000),
    },
    {
      companyName: 'BlueSky Financial Advisory',
      contactName: 'Amanda Brooks',
      contactEmail: 'amanda@blueskyadvisory.com',
      contactPhone: '+1 (555) 678-9012',
      jobTitle: 'Managing Partner',
      status: 'NEW',
      source: 'SOCIAL_MEDIA',
      priority: 'MEDIUM',
      estimatedValue: 95000,
      currency: 'USD',
      notes: 'Reached out via LinkedIn requesting quote for 25 screens legacy modernization.',
      assignedToUserId: null,
      assignedToEmail: null,
      tags: ['Financial', 'LinkedIn', 'Inbound'],
      lastContactedAt: null,
      nextFollowUpAt: new Date(Date.now() + 1 * 86400000),
      createdByUserId: sampleStaff[0].id,
      createdByEmail: sampleStaff[0].email,
      createdAt: new Date(Date.now() - 2 * 86400000),
      updatedAt: new Date(Date.now() - 2 * 86400000),
    },
  ];

  const result = await db.collection('leads').insertMany(leads);
  console.log(`Successfully seeded ${result.insertedCount} leads!`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
