export function sameOrigin(headers: Headers, url: string) {
  return (
    headers.get("origin") === new URL(url).origin &&
    headers.get("content-type")?.split(";")[0] === "application/json"
  );
}
