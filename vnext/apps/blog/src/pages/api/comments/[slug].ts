import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleReaderComments } from "../../../lib/comments-api";
export const ALL:APIRoute=async({request,params})=>{
 try{return await handleReaderComments(request,env as unknown as Parameters<typeof handleReaderComments>[1],params.slug??"");}
 catch{return Response.json({error:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
};
