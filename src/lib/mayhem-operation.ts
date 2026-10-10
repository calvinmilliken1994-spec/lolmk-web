import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type VercelPoolClient } from "@vercel/postgres";

/** Explicit caller pin. No global current event and no write fallback. */
export interface MayhemSelection { eventId: string; generation: number }
interface Operation { selection: MayhemSelection; client?: VercelPoolClient; readonly?: boolean; allowArchived?: boolean; public?: boolean }
const operations = new AsyncLocalStorage<Operation>();
export class MayhemSelectionError extends Error {}
export function selectedMayhemSelection(): MayhemSelection {
  const op = operations.getStore();
  if (!op) throw new MayhemSelectionError("Select a tournament first.");
  return op.selection;
}
export function selectedMayhemId(): string {
  const op = operations.getStore();
  if (!op) throw new MayhemSelectionError("Select a tournament first.");
  return op.selection.eventId;
}
async function validate(op: Operation, client: VercelPoolClient, lock: boolean) {
  if (!op.selection || typeof op.selection.eventId !== "string" || !op.selection.eventId ||
      !Number.isInteger(op.selection.generation) || op.selection.generation < 0) {
    throw new MayhemSelectionError("Invalid tournament selection. Refresh and try again.");
  }
  const { rows } = await client.query(`SELECT archived_at, published, registration_generation FROM mayhem_events WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [op.selection.eventId]);
  if (!rows[0]) throw new MayhemSelectionError("Tournament not found. It may have been deleted.");
  if (!op.allowArchived && rows[0].archived_at) throw new MayhemSelectionError("This tournament is archived and read-only.");
  if (op.public && !rows[0].published) throw new MayhemSelectionError("This tournament is not publicly available.");
  if (!op.readonly && Number(rows[0].registration_generation) !== op.selection.generation) {
    throw new MayhemSelectionError("This tournament changed since the page loaded. Refresh and try again.");
  }
}
export async function withMayhemLock<T>(fn: (client: VercelPoolClient) => Promise<T>): Promise<T> {
  const op = operations.getStore();
  if (!op || op.readonly) throw new MayhemSelectionError("Select a writable tournament first.");
  if (op.client) return fn(op.client);
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    await validate(op, client, true);
    const result = await operations.run({ ...op, client }, () => fn(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
export async function runMayhemSelection<T>(selection: MayhemSelection, fn: () => Promise<T>, options: { readonly?: boolean; network?: boolean; allowArchived?: boolean; public?: boolean } = {}): Promise<T> {
  return operations.run({ selection, ...options }, async () => {
    if (!options.readonly && !options.network) return withMayhemLock(fn);
    const client = await sql.connect();
    try { await validate({ selection, ...options }, client, false); }
    finally { client.release(); }
    return fn();
  });
}
// All legacy SQL in an action uses the SAME transaction client as its outer
// event lock. Network actions release that lock before Discord calls; every
// subsequent write reacquires it and rejects archive/delete/reset races.
async function query(text: string, params?: unknown[]) {
  const op = operations.getStore();
  if (op?.client) return op.client.query(text, params);
  if (op && !/^\s*SELECT\b/i.test(text)) return withMayhemLock(client => client.query(text, params));
  return sql.query(text, params);
}
export const mayhemSql = Object.assign(
  (parts: TemplateStringsArray, ...params: (string | number | boolean | null | undefined)[]) => query(parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), params),
  { query },
);
