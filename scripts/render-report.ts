import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { renderReportReading } from "../lib/report-reading";

const [input, output, ...rest] = process.argv.slice(2);
if (!input || extname(input).toLowerCase() !== ".json" || rest.length)
  throw new Error("사용법 npm run report:render -- INPUT.json [OUTPUT.html]");

const target = resolve(
  output ??
    join(
      dirname(input),
      `${basename(input, extname(input))}-astra-template-v1-reading.html`,
    ),
);
if (extname(target).toLowerCase() !== ".html")
  throw new Error("출력 파일의 확장자는 .html이어야 합니다.");

const [raw, css, shellCss, font, fontLicense, logo] = await Promise.all([
  readFile(input, "utf8"),
  readFile(new URL("../templates/report-reading.css", import.meta.url), "utf8"),
  readFile(
    new URL("../templates/report-reading-standalone.css", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../public/fonts/pretendard/PretendardVariable.woff2",
      import.meta.url,
    ),
  ),
  readFile(
    new URL("../public/fonts/pretendard/LICENSE.txt", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../public/brand/noct-mark.svg", import.meta.url)),
]);
const html = renderReportReading(JSON.parse(raw.replace(/^\uFEFF/, "")), {
  css,
  shellCss,
  font,
  fontLicense,
  logo,
});
await writeFile(target, html, { flag: "wx", mode: 0o600 });
console.log(target);
