const { execSync } = require('child_process');

console.log('🚀 Starting D1 Database Setup...');

try {
  // 1. 创建数据库 (不带 --json，直接解析文本输出)
  console.log('📦 Creating D1 database...');
  let dbId = process.env.D1_DATABASE_ID;

  if (!dbId) {
    const dbName = 'cf-db-' + Math.random().toString(36).substring(7);
    console.log(`Generating DB name: ${dbName}`);
    
    // 执行创建命令，捕获纯文本输出
    const output = execSync(`npx wrangler d1 create ${dbName}`, { encoding: 'utf-8' });
    console.log(output);

    // 从输出中提取 ID (格式通常为: Created database xxx (id: xxxx))
    const idMatch = output.match(/id:\s*([a-f0-9-]+)/i);
    if (idMatch && idMatch[1]) {
      dbId = idMatch[1];
      console.log(`✅ Database created with ID: ${dbId}`);
      
      // 写入环境变量文件供后续步骤使用
      const fs = require('fs');
      fs.appendFileSync('.env', `D1_DATABASE_ID=${dbId}\n`);
      
      // 更新 wrangler.toml
      const tomlContent = `name = "cf-db-api"\ncompatibility_date = "2024-01-01"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbId}"\n`;
      fs.writeFileSync('wrangler.toml', tomlContent);
      console.log('✅ wrangler.toml updated');
    } else {
      throw new Error('Could not parse database ID from output');
    }
  } else {
    console.log('✅ Using existing D1_DATABASE_ID from environment');
    
    // 如果已有ID，只更新 wrangler.toml
    const fs = require('fs');
    const tomlContent = `name = "cf-db-api"\ncompatibility_date = "2024-01-01"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "existing-db"\ndatabase_id = "${dbId}"\n`;
    fs.writeFileSync('wrangler.toml', tomlContent);
  }

  console.log('✅ D1 Setup Complete!');

} catch (error) {
  console.error('❌ Setup failed:', error.message);
  console.error(error.stdout?.toString() || '');
  process.exit(1);
}
