/**
 * Load demo-catalog.csv into the LOCAL D1 database.
 *
 *   node scripts/seed.mjs                 # seeds demo-store-db (local)
 *   node scripts/seed.mjs catalog.csv my-db
 *
 * Default catalog path is docs/demo-catalog.csv, relative to the store/ project.
 *
 * What it does:
 *   1. Parses demo-catalog.csv (RFC 4180: quoted fields, "" escapes, CRLF).
 *      Strict: any row whose field count does not match the header fails the
 *      import with the row number and both counts - no guessing, no repairs.
 *   2. Writes an idempotent SQL script to scripts/.tmp/seed.sql (gitignored).
 *   3. Runs it with `wrangler d1 execute --local`.
 *
 * Idempotent: re-running updates existing rows (ON CONFLICT(slug)) and never
 * creates duplicates. Product ids are uuid v4 and stay stable after first insert,
 * so order_items references are not broken by a re-seed.
 *
 * LOCAL ONLY. No --remote, no deploy, nothing in the Cloudflare account changes.
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = resolve(ROOT, process.argv[2] ?? "docs/demo-catalog.csv");
const dbName = process.argv[3] ?? "demo-store-db";
const tmpDir = join(ROOT, "scripts", ".tmp");
const sqlPath = join(tmpDir, "seed.sql");

/** Minimal RFC 4180 CSV parser: handles quoted fields, "" escapes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** SQL-escape a text value (single quotes doubled). */
function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const HEADERS = [
  "slug",
  "name",
  "type",
  "category",
  "price_cents",
  "stock",
  "description",
  "active",
];

function fail(message) {
  console.error(`\nseed: ${message}`);
  process.exit(1);
}

const raw = parseCsv(readFileSync(csvPath, "utf8")).filter(
  (row) => row.length > 1 || (row.length === 1 && row[0].trim() !== ""),
);

const header = raw.shift().map((h) => h.trim().toLowerCase());
for (const column of HEADERS) {
  if (!header.includes(column)) {
    fail(`demo-catalog.csv is missing the "${column}" column.`);
  }
}
const at = Object.fromEntries(HEADERS.map((column) => [column, header.indexOf(column)]));

const TYPES = new Set(["physical", "digital", "service"]);
const seen = new Set();
const values = [];

raw.forEach((row, index) => {
  // Strict: a row that does not match the header is a defect in the data file.
  // Fail loudly rather than guessing which column the extra fields belong to.
  if (row.length !== header.length) {
    fail(
      `row ${index + 2}: expected ${header.length} fields, got ${row.length} ` +
        `(an unquoted comma is the usual cause).`,
    );
  }

  const slug = (row[at.slug] ?? "").trim();
  const name = (row[at.name] ?? "").trim();
  const type = (row[at.type] ?? "").trim();
  const category = (row[at.category] ?? "").trim();
  const price = Number.parseInt((row[at.price_cents] ?? "").trim(), 10);
  const stockRaw = (row[at.stock] ?? "").trim();
  const description = (row[at.description] ?? "").trim();
  const activeRaw = (row[at.active] ?? "1").trim();

  if (!slug || !name) fail(`row ${index + 2}: slug and name are required.`);
  if (seen.has(slug)) fail(`row ${index + 2}: duplicate slug "${slug}".`);
  seen.add(slug);

  if (!TYPES.has(type)) fail(`row ${index + 2}: type must be physical, digital or service.`);
  if (!Number.isInteger(price) || price < 0) {
    fail(`row ${index + 2}: price_cents must be a non-negative integer.`);
  }
  if (activeRaw !== "0" && activeRaw !== "1") {
    fail(`row ${index + 2}: active must be 0 or 1.`);
  }

  // Spec rule: stock is NULL for digital and service, an integer for physical.
  let stock = null;
  if (stockRaw === "") {
    if (type === "physical") {
      fail(`row ${index + 2}: physical product "${slug}" must carry a stock count.`);
    }
  } else {
    stock = Number.parseInt(stockRaw, 10);
    if (type !== "physical") {
      fail(`row ${index + 2}: "${slug}" is ${type}; stock must be NULL (leave it empty).`);
    }
    if (!Number.isInteger(stock) || stock < 0) {
      fail(`row ${index + 2}: stock must be a non-negative integer or empty.`);
    }
  }

  values.push({
    id: randomUUID(),
    slug,
    name,
    description,
    type,
    category: category === "" ? null : category,
    price,
    stock,
    active: Number.parseInt(activeRaw, 10),
    sortOrder: index,
  });
});

if (values.length === 0) fail("demo-catalog.csv contained no product rows.");

const statements = values.map(
  (p) => `INSERT INTO products
  (id, slug, name, description, type, category, price_cents, currency, stock, image_key, active, sort_order, created_at, updated_at)
VALUES
  (${sqlText(p.id)}, ${sqlText(p.slug)}, ${sqlText(p.name)}, ${sqlText(p.description)}, ${sqlText(p.type)},
   ${p.category === null ? "NULL" : sqlText(p.category)}, ${p.price}, 'usd',
   ${p.stock === null ? "NULL" : p.stock}, NULL, ${p.active}, ${p.sortOrder},
   datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET
  name        = excluded.name,
  description = excluded.description,
  type        = excluded.type,
  category    = excluded.category,
  price_cents = excluded.price_cents,
  stock       = excluded.stock,
  active      = excluded.active,
  sort_order  = excluded.sort_order,
  updated_at  = datetime('now');`,
);

// No explicit BEGIN/COMMIT: local D1 (workerd) rejects SQL transactions and
// requires the storage transaction API instead. Each INSERT is idempotent.
const sql = `-- Generated by scripts/seed.mjs from docs/demo-catalog.csv. Do not edit by hand.\n${statements.join(
  "\n\n",
)}\n`;

mkdirSync(tmpDir, { recursive: true });
writeFileSync(sqlPath, sql, "utf8");

const byType = values.reduce((acc, p) => {
  acc[p.type] = (acc[p.type] ?? 0) + 1;
  return acc;
}, {});
const soldOut = values.filter((p) => p.type === "physical" && p.stock === 0).length;

console.log(`seed: parsed ${values.length} products from ${csvPath}`);
console.log(
  `seed: physical ${byType.physical ?? 0}, digital ${byType.digital ?? 0}, service ${
    byType.service ?? 0
  }; physical items at stock 0: ${soldOut}`,
);
console.log(`seed: wrote ${sqlPath}`);
console.log(`seed: applying to local D1 "${dbName}"...\n`);

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", dbName, "--local", `--file=${sqlPath}`],
  { cwd: ROOT, stdio: "inherit", shell: true },
);

process.exit(result.status ?? 1);
