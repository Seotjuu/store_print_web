function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name}가 설정되지 않았습니다. .env.local 파일을 확인하세요.`
    );
  }
  return value;
}

export function getNaverClientId() {
  return requireEnv("NAVER_CLIENT_ID");
}

export function getNaverClientSecret() {
  return requireEnv("NAVER_CLIENT_SECRET");
}

export function getNaverAccountId() {
  return process.env.NAVER_ACCOUNT_ID || undefined;
}

export const NAVER_API_BASE = "https://api.commerce.naver.com/external";
export const NAVER_TOKEN_URL = `${NAVER_API_BASE}/v1/oauth2/token`;

// 발송처리 API의 deliveryCompanyCode 값으로 사용하는 택배사 코드 목록.
export const DELIVERY_COMPANIES = [
  { code: "HANJIN", name: "한진택배" },
  { code: "CJGLS", name: "CJ대한통운" },
] as const;

export type DeliveryCompanyCode = (typeof DELIVERY_COMPANIES)[number]["code"];
