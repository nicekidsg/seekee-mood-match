import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

test("the hosted page receives an absolute social-card URL from its request origin", async () => {
  const env = {
    ASSETS: {
      fetch: async () => new Response(
        '<meta property="og:image" content="__SITE_ORIGIN__/og.png">',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    },
  };

  const response = await worker.fetch(new Request("https://music.example/"), env);
  assert.match(await response.text(), /https:\/\/music\.example\/og\.png/);
});
