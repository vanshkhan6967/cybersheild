
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://vanshkhan6967.github.io")
  .split(",")
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  const origin = req.headers.origin?.replace(/\/$/, "");
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(origin && allowedOrigins.includes(origin) ? 204 : 403);
  }
  next();
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));

app.use("/api/", rateLimit({
  windowMs: 60000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Cyber Shield API", health: "/api/health" });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  });
});

app.post("/api/generate-quiz", async (req, res) => {
  const { topic, difficulty, count } = req.body || {};
  const questionCount = Number(count);

  if (typeof topic !== "string" || !topic.trim() || topic.trim().length > 2000) {
    return res.status(400).json({ error: "Topic is required and must be 2,000 characters or fewer." });
  }

  if (!["Beginner", "Intermediate", "Advanced"].includes(difficulty)) {
    return res.status(400).json({ error: "Choose a valid difficulty." });
  }

  if (![5, 8, 10].includes(questionCount)) {
    return res.status(400).json({ error: "Choose 5, 8, or 10 questions." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI service is not configured." });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: "Create accurate educational cyber-safety quizzes. Return only a JSON object with a questions array. Each question must contain question, options (four objects with id A/B/C/D and text), answer (A/B/C/D), and explanation. Exactly one answer must be correct.",
      text: { format: { type: "json_object" } },
      input: `Generate exactly ${questionCount} multiple-choice questions. Return the result as valid JSON.\nTopic: ${topic.trim()}\nDifficulty: ${difficulty}\nLanguage: English.`,
      max_output_tokens: 4500
    });

    const parsed = JSON.parse(response.output_text);
    const questions = parsed?.questions;

    if (!Array.isArray(questions) || questions.length !== questionCount) {
      return res.status(502).json({ error: "AI returned an invalid number of questions." });
    }

    for (const q of questions) {
      if (
        typeof q?.question !== "string" ||
        typeof q?.explanation !== "string" ||
        !["A", "B", "C", "D"].includes(q.answer) ||
        !Array.isArray(q.options) ||
        q.options.length !== 4
      ) {
        return res.status(502).json({ error: "AI returned invalid quiz data." });
      }
    }

    return res.json({ questions });
  } catch (error) {
    console.error("OpenAI request failed:", error);

    if (error?.status === 401) {
      return res.status(502).json({ error: "OpenAI API key is invalid." });
    }
    if (error?.status === 429) {
      return res.status(429).json({ error: "OpenAI usage limit or quota reached." });
    }

    return res.status(502).json({ error: "AI could not generate the quiz. Check Render logs." });
  }
});

app.listen(port, () => {
  console.log(`Cyber Shield API listening on port ${port}`);
});
