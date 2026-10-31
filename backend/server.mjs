
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";

const app = express();
const port = Number(process.env.PORT || 3000);

const GROQ_MODEL =
  process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "https://vanshkhan6967.github.io"
)
  .split(",")
  .map(v => v.trim().replace(/\/$/, ""))
  .filter(Boolean);

const client = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: 90000,
      maxRetries: 1
    })
  : null;

// SECURITY
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

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Cyber Shield API",
    provider: "Groq"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Cyber Shield API",
    provider: "Groq",
    aiConfigured: Boolean(client),
    model: GROQ_MODEL
  });
});

// STRICT JSON SCHEMA
function getQuizSchema() {
  const option = {
    type: "object",
    properties: {
      id: {
        type: "string",
        enum: ["A", "B", "C", "D"]
      },
      text: {
        type: "string"
      }
    },
    required: ["id", "text"],
    additionalProperties: false
  };

  const question = {
    type: "object",
    properties: {
      question: { type: "string" },
      options: {
        type: "array",
        items: option
      },
      answer: {
        type: "string",
        enum: ["A", "B", "C", "D"]
      },
      explanation: { type: "string" }
    },
    required: [
      "question",
      "options",
      "answer",
      "explanation"
    ],
    additionalProperties: false
  };

  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: question
      }
    },
    required: ["questions"],
    additionalProperties: false
  };
}

// GENERATE QUIZ
app.post("/api/generate-quiz", async (req, res) => {
  const { topic, difficulty, count } = req.body || {};
  const questionCount = Number(count);

  if (
    typeof topic !== "string" ||
    !topic.trim() ||
    topic.trim().length > 2000
  ) {
    return res.status(400).json({
      error: "Enter a valid quiz topic."
    });
  }

  if (!["Beginner", "Intermediate", "Advanced"].includes(difficulty)) {
    return res.status(400).json({
      error: "Invalid difficulty."
    });
  }

  if (![5, 8, 10].includes(questionCount)) {
    return res.status(400).json({
      error: "Question count must be 5, 8, or 10."
    });
  }

  if (!client) {
    return res.status(503).json({
      error: "Groq API key is not configured."
    });
  }

  try {
    const variationId = randomUUID();

    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,

      messages: [
        {
          role: "system",
          content: `
You are the Cyber Shield educational quiz generator.

Generate accurate, age-appropriate cybersecurity awareness questions.

Every quiz must contain genuinely varied questions.
Avoid repeating questions or using the same scenario repeatedly.
Use realistic educational situations.
Make all four answer options plausible.
Exactly one answer must be correct.
Write clear explanations.

Return the requested structured quiz only.
`
        },
        {
          role: "user",
          content: `
Generate exactly ${questionCount} new questions.

Topic: ${topic.trim()}
Difficulty: ${difficulty}
Language: English.

Variation ID: ${variationId}

Use this variation ID to inspire a different selection of
scenarios and knowledge points. Do not mention it in the quiz.

Do not copy a previous question set.
`
        }
      ],

      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cyber_shield_quiz",
          strict: true,
          schema: getQuizSchema()
        }
      },

      temperature: 0.7,
      max_completion_tokens: 6000
    });

    const output =
      completion.choices?.[0]?.message?.content;

    if (!output) {
      throw new Error("Groq returned an empty response.");
    }

    const parsed = JSON.parse(output);
    const questions = parsed.questions;

    if (
      !Array.isArray(questions) ||
      questions.length !== questionCount
    ) {
      throw new Error("Incorrect question count.");
    }

    for (const q of questions) {
      const ids = ["A", "B", "C", "D"];

      if (
        typeof q.question !== "string" ||
        !q.question.trim() ||
        typeof q.explanation !== "string" ||
        !q.explanation.trim() ||
        !ids.includes(q.answer) ||
        !Array.isArray(q.options) ||
        q.options.length !== 4
      ) {
        throw new Error("Invalid question structure.");
      }

      const optionIds = q.options.map(o => o.id);

      if (
        new Set(optionIds).size !== 4 ||
        !ids.every(id => optionIds.includes(id)) ||
        q.options.some(
          o => typeof o.text !== "string" || !o.text.trim()
        )
      ) {
        throw new Error("Invalid answer options.");
      }
    }

    const uniqueQuestions = new Set(
      questions.map(q => q.question.trim().toLowerCase())
    );

    if (uniqueQuestions.size !== questions.length) {
      throw new Error("Duplicate questions detected.");
    }

    console.log(
      `Generated ${questions.length} questions for: ${topic.trim()}`
    );

    return res.json({ questions });

  } catch (error) {
    console.error("Groq quiz error:", {
      status: error?.status,
      code: error?.code,
      message: error?.message
    });

    if (error?.status === 401) {
      return res.status(502).json({
        error: "Invalid Groq API key."
      });
    }

    if (error?.status === 429) {
      return res.status(429).json({
        error: "Groq free usage limit reached. Please try again later."
      });
    }

    return res.status(502).json({
      error: "Quiz generation failed. Please try again."
    });
  }
});

// START SERVER
app.listen(port, () => {
  console.log(`Cyber Shield API listening on port ${port}`);
  console.log("AI Provider: Groq");
  console.log(`AI Model: ${GROQ_MODEL}`);
});
