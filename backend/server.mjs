
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);

// ================= CONFIGURATION =================

const GROQ_MODEL =
  process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "https://vanshkhan6967.github.io"
)
  .split(",")
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

// Groq uses an OpenAI-compatible API.
const client = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: 60000,
      maxRetries: 1
    })
  : null;

// ================= SECURITY =================

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  const origin = req.headers.origin?.replace(/\/$/, "");

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(
      origin && allowedOrigins.includes(origin) ? 204 : 403
    );
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

// ================= HOME =================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Cyber Shield API",
    provider: "Groq",
    health: "/api/health"
  });
});

// ================= HEALTH CHECK =================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Cyber Shield API",
    provider: "Groq",
    aiConfigured: Boolean(client),
    model: GROQ_MODEL
  });
});

// ================= AI QUIZ GENERATOR =================

app.post("/api/generate-quiz", async (req, res) => {
  const { topic, difficulty, count } = req.body || {};
  const questionCount = Number(count);

  // Validate topic
  if (
    typeof topic !== "string" ||
    !topic.trim() ||
    topic.trim().length > 2000
  ) {
    return res.status(400).json({
      error: "Topic is required and must be 2,000 characters or fewer."
    });
  }

  // Validate difficulty
  if (!["Beginner", "Intermediate", "Advanced"].includes(difficulty)) {
    return res.status(400).json({
      error: "Choose a valid difficulty."
    });
  }

  // Validate question count
  if (![5, 8, 10].includes(questionCount)) {
    return res.status(400).json({
      error: "Choose 5, 8, or 10 questions."
    });
  }

  // Check API configuration
  if (!client) {
    return res.status(503).json({
      error: "Groq AI service is not configured. Check GROQ_API_KEY."
    });
  }

  try {
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,

      messages: [
        {
          role: "system",
          content: `
You are Cyber Shield's educational quiz generator.

Create accurate, age-appropriate cyber-safety questions.

Return ONLY a valid JSON object in this exact structure:

{
  "questions": [
    {
      "question": "Question text",
      "options": [
        { "id": "A", "text": "Option A" },
        { "id": "B", "text": "Option B" },
        { "id": "C", "text": "Option C" },
        { "id": "D", "text": "Option D" }
      ],
      "answer": "A",
      "explanation": "Explanation of the correct answer."
    }
  ]
}

Rules:
1. Generate exactly the requested number of questions.
2. Every question must have exactly four options.
3. Option IDs must be A, B, C and D.
4. Exactly one answer must be correct.
5. The answer must match one option ID.
6. Explanations must be educational and clear.
7. Questions must match the requested difficulty.
8. Do not include markdown or text outside the JSON.
9. Do not repeat questions.
`
        },
        {
          role: "user",
          content: `
Generate exactly ${questionCount} multiple-choice questions.

Topic: ${topic.trim()}
Difficulty: ${difficulty}
Language: English.
`
        }
      ],

      response_format: {
        type: "json_object"
      },

      temperature: 0.2,
      max_completion_tokens: 4500
    });

    const output =
      completion.choices?.[0]?.message?.content;

    if (!output) {
      return res.status(502).json({
        error: "Groq returned an empty response."
      });
    }

    const parsed = JSON.parse(output);
    const questions = parsed?.questions;

    // Validate number of questions
    if (
      !Array.isArray(questions) ||
      questions.length !== questionCount
    ) {
      return res.status(502).json({
        error: "AI returned an invalid number of questions."
      });
    }

    // Validate each question
    for (const q of questions) {
      const validIds = ["A", "B", "C", "D"];

      if (
        typeof q?.question !== "string" ||
        !q.question.trim() ||
        typeof q?.explanation !== "string" ||
        !q.explanation.trim() ||
        !validIds.includes(q.answer) ||
        !Array.isArray(q.options) ||
        q.options.length !== 4
      ) {
        return res.status(502).json({
          error: "AI returned invalid quiz data."
        });
      }

      const optionIds = q.options.map(option => option?.id);

      if (
        !validIds.every(id => optionIds.includes(id)) ||
        new Set(optionIds).size !== 4 ||
        q.options.some(
          option =>
            typeof option?.text !== "string" ||
            !option.text.trim()
        )
      ) {
        return res.status(502).json({
          error: "AI returned invalid answer options."
        });
      }
    }

    // Return the same response structure as before.
    return res.json({ questions });

  } catch (error) {
    console.error("Groq request failed:", {
      status: error?.status,
      code: error?.code,
      message: error?.message
    });

    if (error?.status === 401) {
      return res.status(502).json({
        error: "Groq API key is invalid. Check your Render environment."
      });
    }

    if (error?.status === 429) {
      return res.status(429).json({
        error: "Groq usage limit reached. Please try again later."
      });
    }

    if (error?.status === 400) {
      return res.status(502).json({
        error: "Groq rejected the request. Check the model configuration."
      });
    }

    if (error?.status === 503 || error?.status === 502) {
      return res.status(503).json({
        error: "Groq AI is temporarily unavailable. Try again later."
      });
    }

    return res.status(502).json({
      error: "AI could not generate the quiz. Please try again."
    });
  }
});

// ================= START SERVER =================

app.listen(port, () => {
  console.log(`Cyber Shield API listening on port ${port}`);
  console.log(`AI Provider: Groq`);
  console.log(`AI Model: ${GROQ_MODEL}`);
});
