/**
 * Run once to create the `leads` table.
 *
 *   npx tsx scripts/init-db.ts
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), ".env.local") });

import mysql from "mysql2/promise";

async function main() {
  // Connect without specifying a database first
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const dbName = process.env.DB_NAME!;

  // Create database if it doesn't exist
  await connection.execute(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\``
  );
  console.log(`✓ database '${dbName}' ready`);

  await connection.changeUser({ database: dbName });

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS leads (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255),
      email       VARCHAR(255),
      phone       VARCHAR(50),
      company     VARCHAR(255),
      image_url   VARCHAR(512),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✓ leads table ready");
  await connection.end();
}

main().catch((err) => {
  console.error("✗ init-db failed:", err);
  process.exit(1);
});
