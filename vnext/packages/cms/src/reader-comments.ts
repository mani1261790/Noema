import { z } from "zod";
export const readerCommentInput = z.object({
 id: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/),
 name: z.string().trim().min(1).max(40), body: z.string().trim().min(1).max(2000),
 parentId: z.string().uuid().nullable().default(null), website: z.string().max(0).optional()
});
export interface ReaderComment {
 id: string; parent_id: string | null; author_name: string; author_kind: "reader" | "staff";
 body: string; created_at: number; status: string;
}
export interface CommentsStatement {
 bind(...values: unknown[]): CommentsStatement;
 first<T = Record<string, unknown>>(): Promise<T | null>;
 all<T = Record<string, unknown>>(): Promise<{results: T[]}>;
 run(): Promise<unknown>;
}
export interface CommentsDatabase { prepare(query: string): CommentsStatement }
export async function commentTokenHash(token: string): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function readCommentJson(request: Request): Promise<unknown> {
 if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("invalid_body");
 const reader=request.body?.getReader(); if(!reader)throw new Error("invalid_body");
 let size=0, text=""; const decoder=new TextDecoder();
 while(true){ const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
 if(size>12000){await reader.cancel();throw new Error("invalid_body");}text+=decoder.decode(part.value,{stream:true}); }
 return JSON.parse(text+decoder.decode());
}
