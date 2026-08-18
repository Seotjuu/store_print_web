import bcrypt from "bcryptjs";
import {
  NAVER_TOKEN_URL,
  getNaverAccountId,
  getNaverClientId,
  getNaverClientSecret,
} from "./config";

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

// 네이버 커머스 API 서명 규칙: bcrypt(`${clientId}_${timestamp}`, clientSecret) 후 base64 인코딩.
// clientSecret 자체가 bcrypt salt 형식 문자열이어야 한다 (애플리케이션 등록 시 발급되는 값 그대로 사용).
function createSignature(clientId: string, clientSecret: string, timestamp: number) {
  const password = `${clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(hashed, "utf-8").toString("base64");
}

async function issueAccessToken(): Promise<TokenResponse> {
  const clientId = getNaverClientId();
  const clientSecret = getNaverClientSecret();
  const accountId = getNaverAccountId();
  const timestamp = Date.now();
  const signature = createSignature(clientId, clientSecret, timestamp);

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: signature,
    grant_type: "client_credentials",
    type: "SELF",
  });
  if (accountId) {
    body.set("account_id", accountId);
  }

  const res = await fetch(NAVER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 액세스 토큰 발급 실패 (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5_000) {
    return cachedToken.accessToken;
  }

  const token = await issueAccessToken();
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: now + token.expires_in * 1000,
  };
  return cachedToken.accessToken;
}
