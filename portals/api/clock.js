// The clock for a whole run: every portal in a browser reads the same cookie. GET says what it is, POST sets it from a date or a
// chapter, and an empty POST takes it off. A blind run sets it once, before it starts.
"use strict";
const { json, readBody, secure } = require("../lib/http");
const Clock = require("../lib/clock");
const { clockOf } = require("../lib/view");

const public_ = Clock.CHAPTERS.map(({ chapter, today }) => ({ chapter, today })); // the days and not the story: a blind run reads this

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      const body = await readBody(req);
      const clock = body.chapter != null && body.chapter !== "" ? Clock.parse(`chapter-${body.chapter}`) : Clock.parse(body.today != null ? body.today : body.as_of);
      if (!clock) return json(res, 400, { error: "A clock is a date, YYYY-MM-DD, or a chapter number." });
      res.setHeader("Set-Cookie", Clock.setCookie(clock, secure(req)));
      return json(res, 200, { ok: true, today: clock.as_of, as_of: clock.as_of, chapter: clock.chapter });
    }
    const clock = clockOf(req);
    return json(res, 200, { today: clock.as_of, as_of: clock.as_of, chapter: clock.chapter, chapters: public_ });
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
};
