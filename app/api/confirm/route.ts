import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errorMessage";
import { confirmProductOrders } from "@/lib/naver/client";

export async function POST(request: NextRequest) {
  const body: { productOrderIds: string[] } = await request.json();

  if (!Array.isArray(body.productOrderIds) || body.productOrderIds.length === 0) {
    return NextResponse.json({ error: "productOrderIds가 비어 있습니다." }, { status: 400 });
  }

  try {
    const results = await confirmProductOrders(body.productOrderIds);
    return NextResponse.json({ results });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
