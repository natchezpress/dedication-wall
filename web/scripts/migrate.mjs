// Apply D1 migrations to the right database for this build.
// On main (or locally with no branch), the production database; on any other branch, the preview
// database named by preview_database_id in wrangler.jsonc (wrangler's --preview flag).
// Workers Builds sets WORKERS_CI_BRANCH; wrangler reads CLOUDFLARE_API_TOKEN from the build environment.
import { execSync } from 'node:child_process';

const branch = process.env.WORKERS_CI_BRANCH || process.env.BRANCH || 'main';
const remote = process.argv.includes('--local') ? '--local' : '--remote';
// --preview is a remote-only flag; local dev always uses the one local database.
const preview = branch === 'main' || remote === '--local' ? '' : '--preview';

console.log(`migrate: branch=${branch} target=${preview ? 'preview database' : 'production database'} ${remote}`);
execSync(`npx wrangler d1 migrations apply dedication-wall ${preview} ${remote}`, { stdio: 'inherit' });
