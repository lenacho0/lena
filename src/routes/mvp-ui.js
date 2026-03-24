import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mvpDir = path.resolve(__dirname, "../ui/mvp");

const indexHtml = readFileSync(path.join(mvpDir, "index.html"), "utf8");
const stylesCss = readFileSync(path.join(mvpDir, "styles.css"), "utf8");
const appJs = readFileSync(path.join(mvpDir, "app.js"), "utf8");

const mvpUi = new Hono();

mvpUi.get("/", (c) => c.html(indexHtml));

mvpUi.get("/styles.css", (c) =>
  c.body(stylesCss, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "no-store",
  }),
);

mvpUi.get("/app.js", (c) =>
  c.body(appJs, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  }),
);

export { mvpUi };
