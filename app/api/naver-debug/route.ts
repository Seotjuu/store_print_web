import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errorMessage";
import { fetchRawDebugSample } from "@/lib/naver/client";

// 네이버 API 실제 응답 구조를 확인하기 위한 임시 디버그 엔드포인트.
// lib/naver/client.ts의 normalizeProductOrder() 필드 매핑을 검증한 뒤에는 삭제해도 된다.
// ?type=DISPATCHED 로 호출하면 발송완료 건의 raw 응답(운송장/택배사 필드 위치 확인용)을 볼 수 있다.
export async function GET(request: NextRequest) {
  try {
    const lastChangedType = request.nextUrl.searchParams.get("type") ?? "PAYED";
    const sample = await fetchRawDebugSample(7, lastChangedType);
    return NextResponse.json(sample);
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
