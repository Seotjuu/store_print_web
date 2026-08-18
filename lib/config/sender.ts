export function getSenderInfo() {
  return {
    name: process.env.SENDER_NAME ?? "(SENDER_NAME 미설정)",
    phone: process.env.SENDER_PHONE ?? "(SENDER_PHONE 미설정)",
    address: process.env.SENDER_ADDRESS ?? "(SENDER_ADDRESS 미설정)",
    addressDetail: process.env.SENDER_ADDRESS_DETAIL ?? "",
  };
}
