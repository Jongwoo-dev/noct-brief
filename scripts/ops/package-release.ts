import {
  cp,
  mkdir,
  readdir,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve, join, relative } from "node:path";
// Produce a new allowlisted release tree; never copy the working directory wholesale.
const root = resolve("dist"),
  destination = resolve(
    root,
    `release-${new Date().toISOString().replaceAll(":", "-")}`,
  );
await mkdir(destination, { recursive: true });
const roots = [
  ".next/standalone",
  ".next/static",
  "scripts/env.ts",
  "scripts/migrate.ts",
  "scripts/worker.ts",
  "scripts/import-bundle.ts",
  "scripts/ops",
  "lib",
  "data",
  "public",
  "db",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];
const allowed = (source: string) =>
  !source
    .split(/[\\/]/)
    .some(
      (part) =>
        part.startsWith(".env") ||
        part === ".local" ||
        part === "temp" ||
        part.startsWith("AGENTS") ||
        part === "secrets" ||
        part === "credentials",
    );
for (const entry of roots)
  await cp(resolve(entry), resolve(destination, entry), {
    recursive: true,
    dereference: true,
    filter: allowed,
  });
await cp(
  resolve(".next/static"),
  resolve(destination, ".next/standalone/.next/static"),
  { recursive: true },
);
await cp(resolve("public"), resolve(destination, ".next/standalone/public"), {
  recursive: true,
  filter: allowed,
});
const manifest: string[] = [];
async function inspect(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (entry.isFile()) {
      if (!allowed(path)) throw new Error("Unexpected release file");
      manifest.push(relative(destination, path).replaceAll("\\", "/"));
    }
  }
}
await inspect(destination);
await writeFile(
  join(destination, "release-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await stat(join(destination, ".next/standalone/server.js"));
console.log(
  `Release ${pkg.version}: ${destination} (${manifest.length} files). Not deployed.`,
);
