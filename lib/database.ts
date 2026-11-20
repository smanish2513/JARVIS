import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;
type ExpenseRow = {
  id: string;
  merchant: string;
  category: string;
  amount: number | string;
  spent_on: string | Date;
};

let client: Sql | null = null;
let schemaPromise: Promise<void> | null = null;

export function getDatabase(): Sql | null {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) return null;
  client ??= neon(connectionString);
  return client;
}

export async function ensureDatabaseSchema(sql: Sql): Promise<void> {
  schemaPromise ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS jarvis_expenses (
      id uuid PRIMARY KEY,
      owner_id varchar(64) NOT NULL,
      merchant varchar(160) NOT NULL,
      category varchar(80) NOT NULL,
      amount numeric(12, 2) NOT NULL CHECK (amount > 0),
      spent_on date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS jarvis_expenses_owner_date_idx
      ON jarvis_expenses (owner_id, spent_on DESC, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS jarvis_email_alerts (
      owner_id varchar(64) NOT NULL,
      gmail_message_id varchar(512) NOT NULL,
      notified_at timestamptz NOT NULL DEFAULT now(),
      status varchar(16) NOT NULL DEFAULT 'sent',
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, gmail_message_id)
    )`;
    await sql`ALTER TABLE jarvis_email_alerts
      ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'sent'`;
    await sql`ALTER TABLE jarvis_email_alerts
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;
    await sql`CREATE TABLE IF NOT EXISTS jarvis_preferences (
      owner_id varchar(64) PRIMARY KEY,
      gmail_monitor_enabled boolean NOT NULL DEFAULT false,
      gmail_query varchar(2000) NOT NULL DEFAULT 'in:inbox is:unread newer_than:2h',
      gmail_authorized boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE jarvis_preferences
      ADD COLUMN IF NOT EXISTS gmail_authorized boolean NOT NULL DEFAULT false`;
  })().catch((error: unknown) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

export async function getMailMonitorPreference(sql: Sql, ownerId: string) {
  await ensureDatabaseSchema(sql);
  const rows = await sql`SELECT gmail_monitor_enabled, gmail_query, gmail_authorized
    FROM jarvis_preferences WHERE owner_id = ${ownerId} LIMIT 1`;
  const row = rows[0] as { gmail_monitor_enabled: boolean; gmail_query: string; gmail_authorized: boolean } | undefined;
  return row ?? { gmail_monitor_enabled: false, gmail_query: "in:inbox is:unread newer_than:2h", gmail_authorized: false };
}

export async function markGmailAuthorized(sql: Sql, ownerId: string): Promise<void> {
  await ensureDatabaseSchema(sql);
  await sql`INSERT INTO jarvis_preferences
    (owner_id, gmail_monitor_enabled, gmail_query, gmail_authorized, updated_at)
    VALUES (${ownerId}, false, 'in:inbox is:unread newer_than:2h', true, now())
    ON CONFLICT (owner_id) DO UPDATE SET gmail_authorized = true, updated_at = now()`;
}

export async function saveMailMonitorPreference(
  sql: Sql,
  ownerId: string,
  preference: { enabled: boolean; query: string },
): Promise<void> {
  await ensureDatabaseSchema(sql);
  await sql`INSERT INTO jarvis_preferences (owner_id, gmail_monitor_enabled, gmail_query, updated_at)
    VALUES (${ownerId}, ${preference.enabled}, ${preference.query}, now())
    ON CONFLICT (owner_id) DO UPDATE SET
      gmail_monitor_enabled = EXCLUDED.gmail_monitor_enabled,
      gmail_query = EXCLUDED.gmail_query,
      updated_at = now()`;
}

export async function listOwnerExpenses(sql: Sql, ownerId: string) {
  await ensureDatabaseSchema(sql);
  const rows = await sql`SELECT id, merchant, category, amount, spent_on
    FROM jarvis_expenses
    WHERE owner_id = ${ownerId}
    ORDER BY spent_on DESC, created_at DESC` as unknown as ExpenseRow[];
  return rows.map((row) => ({
    id: row.id,
    merchant: row.merchant,
    category: row.category,
    amount: Number(row.amount),
    date: typeof row.spent_on === "string"
      ? row.spent_on.slice(0, 10)
      : row.spent_on.toISOString().slice(0, 10),
  }));
}

export async function insertOwnerExpense(
  sql: Sql,
  ownerId: string,
  expense: { id: string; merchant: string; category: string; amount: number; date: string },
) {
  await ensureDatabaseSchema(sql);
  const rows = await sql`INSERT INTO jarvis_expenses
    (id, owner_id, merchant, category, amount, spent_on)
    VALUES (${expense.id}::uuid, ${ownerId}, ${expense.merchant}, ${expense.category}, ${expense.amount}, ${expense.date}::date)
    RETURNING id, merchant, category, amount, spent_on` as unknown as ExpenseRow[];
  const row = rows[0];
  if (!row) throw new Error("Expense insert returned no row.");
  return {
    id: row.id,
    merchant: row.merchant,
    category: row.category,
    amount: Number(row.amount),
    date: typeof row.spent_on === "string"
      ? row.spent_on.slice(0, 10)
      : row.spent_on.toISOString().slice(0, 10),
  };
}

export async function deleteOwnerExpense(sql: Sql, ownerId: string, id: string): Promise<boolean> {
  await ensureDatabaseSchema(sql);
  const rows = await sql`DELETE FROM jarvis_expenses
    WHERE id = ${id}::uuid AND owner_id = ${ownerId}
    RETURNING id` as unknown as { id: string }[];
  return rows.length > 0;
}
