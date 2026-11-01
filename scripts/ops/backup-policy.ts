export function expiredBackups(keys: string[], now: Date, prefix = "noct-db/") {
  return keys.filter((key) => {
    if (!key.startsWith(prefix)) return false;
    const name = key.slice(prefix.length),
      match = /^noct-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.dump$/.exec(name);
    if (!match) return false;
    const date = Date.parse(
      match[1].replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z"),
    );
    return Number.isFinite(date) && date < now.getTime() - 14 * 86400000;
  });
}
