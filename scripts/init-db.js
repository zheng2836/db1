import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log('🚀 Starting D1 Database Setup...');

try {
  // Step 1: Create D1 Database
  console.log('📦 Creating D1 database...');
  const createOutput = execSync('npx wrangler d1 create cf-db --json', { encoding: 'utf-8' });
  const dbInfo = JSON.parse(createOutput);
  const databaseId = dbInfo[0].uuid;
  
  if (!databaseId) {
    throw new Error('Failed to get database ID');
  }
  
  console.log(`✅ Database created with ID: ${databaseId}`);

  // Step 2: Update wrangler.toml
  console.log('⚙️ Updating wrangler.toml...');
  const wranglerPath = path.join(process.cwd(), 'wrangler.toml');
  let wranglerContent = fs.readFileSync(wranglerPath, 'utf-8');
  
  // Replace or add database binding
  if (wranglerContent.includes('database_id')) {
    wranglerContent = wranglerContent.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`);
  } else {
    wranglerContent += `\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "cf-db"\ndatabase_id = "${databaseId}"\n`;
  }
  
  fs.writeFileSync(wranglerPath, wranglerContent);
  console.log('✅ wrangler.toml updated');

  // Step 3: Initialize database schema
  console.log('🗄️ Initializing database schema...');
  execSync(`npx wrangler d1 execute cf-db --file=- --remote`, {
    input: `
      CREATE TABLE IF NOT EXISTS _schema_info (
        version INTEGER PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO _schema_info (version) VALUES (1);
    `,
    encoding: 'utf-8'
  });
  console.log('✅ Database schema initialized');

  console.log('🎉 Setup complete! Ready to deploy.');
  
} catch (error) {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
}
