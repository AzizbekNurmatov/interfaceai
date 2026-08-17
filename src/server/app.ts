import express, { type Express } from "express";
import {
  dashboardPage,
  loginPage,
  lookupFormPage,
  memberResultPage,
  servicingBlockedPage,
  servicingPage,
} from "./html.js";
import { LOOKUP_DELAY_MS, MOCK_CREDENTIALS, lookupMember } from "./members.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  parseCookies,
  requireSession,
  setSessionCookie,
} from "./session.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (_req, res) => {
    res.redirect("/login");
  });

  app.get("/login", (req, res) => {
    if (getSession(req)) {
      res.redirect("/dashboard");
      return;
    }
    res.type("html").send(loginPage());
  });

  app.post("/login", (req, res) => {
    const username = String(req.body.txtUID ?? "");
    const password = String(req.body.txtPWD ?? "");
    if (username === MOCK_CREDENTIALS.username && password === MOCK_CREDENTIALS.password) {
      const sid = createSession(username);
      setSessionCookie(res, sid);
      res.redirect("/dashboard");
      return;
    }
    res.status(401).type("html").send(loginPage("LOGON FAILED - INVALID USER OR PASSWORD"));
  });

  app.get("/logout", (req, res) => {
    destroySession(parseCookies(req.headers.cookie).MCSID);
    clearSessionCookie(res);
    res.redirect("/login");
  });

  app.get("/dashboard", requireSession, (req, res) => {
    const session = getSession(req);
    res.type("html").send(dashboardPage(session?.user ?? ""));
  });

  app.get("/members/lookup", requireSession, async (req, res) => {
    const memberId = typeof req.query.memID === "string" ? req.query.memID : "";
    if (!memberId) {
      res.type("html").send(lookupFormPage());
      return;
    }

    await delay(LOOKUP_DELAY_MS);
    const outcome = lookupMember(memberId);
    if (outcome.kind === "found") {
      res.type("html").send(memberResultPage(outcome.member));
      return;
    }
    res.type("html").send(lookupFormPage({ error: outcome.message, memberId }));
  });

  app.get("/servicing", requireSession, (_req, res) => {
    res.type("html").send(servicingPage());
  });

  app.post("/servicing/wire", requireSession, (_req, res) => {
    res.status(403).type("html").send(servicingBlockedPage());
  });

  return app;
}
