import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && /railway\.internal/.test(process.env.DATABASE_URL) ? false : (process.env.PGSSL === "1" ? { rejectUnauthorized: false } : false),
});

export async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id text PRIMARY KEY,
      source text NOT NULL,
      url text NOT NULL,
      type text, sqm integer, price integer, floor text, beds integer, year integer,
      location text, multi boolean DEFAULT false, posted text,
      status text NOT NULL DEFAULT 'new',
      note text NOT NULL DEFAULT '',
      first_seen timestamptz NOT NULL DEFAULT now(),
      also_on jsonb NOT NULL DEFAULT '[]'
    );
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS prev_price integer;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS img boolean;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS photo text;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS gone_at timestamptz;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS checked_at timestamptz;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS phone text;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS phone_checked timestamptz;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS details jsonb;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS details_checked timestamptz;
    UPDATE listings SET details_checked=NULL WHERE details IS NOT NULL AND coalesce(details->>'desc','')='' AND jsonb_array_length(coalesce(details->'facts','[]'::jsonb))=0;
    DELETE FROM listings WHERE img = false;
    CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v jsonb NOT NULL);
  `);
}

// one-time cleanup of wrong xe.gr data (footer phone number, mixed-up detail values); runs once
export async function fixXe1() {
  if (await kvGet("fixXe1")) return;
  await pool.query("UPDATE listings SET phone=NULL, phone_checked=NULL WHERE phone='2109091300'");
  await pool.query("UPDATE listings SET details=NULL, details_checked=NULL WHERE source='xe'");
  await kvSet("fixXe1", true);
}

export async function kvGet(k) {
  const r = await pool.query("SELECT v FROM kv WHERE k=$1", [k]);
  return r.rows[0]?.v ?? null;
}
export async function kvSet(k, v) {
  await pool.query("INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v", [k, JSON.stringify(v)]);
}

export const toApi = (r) => ({
  id: r.id, source: r.source, url: r.url, type: r.type, sqm: r.sqm, price: r.price, floor: r.floor,
  beds: r.beds, year: r.year, location: r.location, multi: r.multi, posted: r.posted,
  prevPrice: r.prev_price || undefined, phone: r.phone || undefined, details: r.details || undefined, photo: r.photo || undefined, gone: !!r.gone_at, status: r.status, note: r.note, firstSeen: r.first_seen, alsoOn: r.also_on?.length ? r.also_on : undefined,
});
