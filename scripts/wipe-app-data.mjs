/**
 * Dev / reset: deletes all rows from app tables (users, statements, agreements, benchmark).
 * Requires DATABASE_URL. Run before a clean re-test: `npm run db:wipe`
 * Run: node scripts/wipe-app-data.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.contractedRate.deleteMany();
    await tx.merchantAgreement.deleteMany();
    await tx.parsedData.deleteMany();
    await tx.statement.deleteMany();
    await tx.refreshToken.deleteMany();
    await tx.acquirerRate.deleteMany();
    await tx.acquirer.deleteMany();
    await tx.user.deleteMany();
    await tx.encryptionKeyRegistry.deleteMany();
  });
  // eslint-disable-next-line no-console
  console.log('Wiped: contracted_rates, merchant_agreements, parsed_data, statements, refresh_tokens, acquirer_rates, acquirers, users, encryption_key_registry.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
