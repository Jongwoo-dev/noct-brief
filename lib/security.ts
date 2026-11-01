import { timingSafeEqual, createHash } from "node:crypto";
export function equalSecret(received: string, expected: string) {
  return (
    !!expected &&
    timingSafeEqual(
      createHash("sha256").update(received).digest(),
      createHash("sha256").update(expected).digest(),
    )
  );
}
export function sameOrigin(headers: Headers, url: string) {
  return (
    headers.get("origin") === new URL(url).origin &&
    headers.get("content-type")?.split(";")[0] === "application/json"
  );
}
