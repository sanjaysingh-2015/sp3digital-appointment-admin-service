// Usage:  npm run generate-slots                   (all tenants, next SLOT_HORIZON_DAYS days — the nightly job)
//         npm run generate-slots -- --days 14      (a shorter horizon)
//         npm run generate-slots -- --dry-run      (report only, change nothing)
// Safe to run any number of times; schedule it nightly (cron / Task Scheduler).
require('dotenv').config();
const { sequelize } = require('../src/models');
const slotGenerationService = require('../src/services/slotGenerationService');

(async () => {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  try {
    const summary = await slotGenerationService.generate({
      days: daysIndex >= 0 ? Number(args[daysIndex + 1]) : undefined,
      dryRun: args.includes('--dry-run'),
    });
    console.log(JSON.stringify(summary));
    if (summary.conflicts) console.log(`${summary.conflicts} booked slot(s) no longer match their rule or are on a closure: review them in the appointments list.`);
  } catch (error) {
    console.error('Slot generation failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
