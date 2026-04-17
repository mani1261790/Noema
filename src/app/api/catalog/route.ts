import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/notebooks";

export async function GET() {
  const catalog = await getCatalog();
  return NextResponse.json(catalog, {
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate"
    }
  });
}
