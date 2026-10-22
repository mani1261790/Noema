import type { CmsPublicationDatabase } from "./cms-publication-repository";
/** One atomic counter bounds upstream requests across locations and both reader features. */
export async function reserveReaderAiRequest(db: CmsPublicationDatabase, limit: number, now = new Date()): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return false;
  const day = now.toISOString().slice(0, 10);
  const row = await db.prepare(`INSERT INTO cms_reader_ai_budget(scope, day, requests)
    VALUES ('reader', ?, 1)
    ON CONFLICT(scope) DO UPDATE SET day = excluded.day,
      requests = CASE WHEN cms_reader_ai_budget.day = excluded.day THEN cms_reader_ai_budget.requests + 1 ELSE 1 END
    WHERE cms_reader_ai_budget.day <> excluded.day OR cms_reader_ai_budget.requests < ?
    RETURNING requests`).bind(day, limit).first<{ requests: number }>();
  return row !== null;
}

export function aiJson(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } });
}

export async function readAiRequest(request: Request, origin: string): Promise<unknown> {
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('origin');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('format');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('format');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32_768) { await reader.cancel(); throw new Error('size'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function readAiOutput(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const result = payload as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  const value = result.response ?? result.choices?.[0]?.message?.content;
  return typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : '';
}

export async function runReaderAi(request: Request, system: string, input: string, schema: Record<string, unknown>): Promise<string | Response> {
  const { env } = await import('cloudflare:workers');
  try {
    if (!env.AI || !env.READER_AI_RATE_LIMITER) return aiJson({error:'AI案内は現在利用できません。通常の記事検索をご利用ください。'},503);
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    if (!(await env.READER_AI_RATE_LIMITER.limit({key: ip})).success) return aiJson({error:'続けて利用されています。1分ほど待ってからお試しください。'},429);
    if (!await reserveReaderAiRequest(env.CMS_DB, Number(env.READER_AI_DAILY_LIMIT))) return aiJson({error:'本日のAI利用上限に達しました。記事検索や本文は引き続き利用できます。'},429);
    // Bound input and output independently of the daily request count. Never retry upstream automatically.
    if (system.length + input.length > 24_000) return aiJson({error:'内容が長すぎるためAI案内を実行できませんでした。'},400);
    const result = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      messages: [{role:'system',content: system}, {role:'user',content: input + '\n/no_think'}],
      max_tokens: 900,
      temperature: 0.2,
      response_format: {type:'json_schema',json_schema:schema},
    }, { signal: AbortSignal.timeout(40_000) });
    return readAiOutput(result);
  } catch {
    return aiJson({error:'AI案内に接続できませんでした。通常の記事検索をご利用ください。'},503);
  }
}
