import { NextResponse } from "next/server";
import { getSenderInfo } from "@/lib/config/sender";

export async function GET() {
  return NextResponse.json(getSenderInfo());
}
