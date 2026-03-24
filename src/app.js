import { Hono } from "hono";
import { cors } from "hono/cors";

import { batches } from "./routes/batches.js";
import { mvpUi } from "./routes/mvp-ui.js";
import { scripts } from "./routes/scripts.js";
import { storyboards } from "./routes/storyboards.js";

const app = new Hono();

app.use("*", cors());

app.onError((error, c) => {
  const status = error.status && Number.isInteger(error.status) ? error.status : 500;

  if (status >= 500) {
    console.error(error);
  }

  return c.json(
    {
      error: {
        message: error.message || "Internal server error.",
      },
    },
    status,
  );
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "viral-video-storyboard-api",
  }),
);

app.route("/api/batches", batches);
app.route("/api/scripts", scripts);
app.route("/api/storyboards", storyboards);
app.route("/mvp", mvpUi);

export { app };
