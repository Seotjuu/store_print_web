import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errorMessage";
import { allocateNext, getPoolStatus, registerRange, setNextNumber } from "@/lib/trackingPool/store";

export async function GET() {
  const status = await getPoolStatus();
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    if (body.action === "register") {
      const status = await registerRange(String(body.start), String(body.end));
      return NextResponse.json(status);
    }

    if (body.action === "setNext") {
      const status = await setNextNumber(String(body.number));
      return NextResponse.json(status);
    }

    if (body.action === "allocate") {
      const trackingNumber = await allocateNext();
      return NextResponse.json({ trackingNumber });
    }

    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
