// server.js

import dotenv from "dotenv";
dotenv.config(); // Load env variables FIRST

import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------------- BASIC SETUP ----------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // allow frontend requests
app.use(express.json());

// ---------------- GEMINI SETUP ----------------
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
});

// ---------------- HEALTH CHECK ----------------
app.get("/", (req, res) => {
  res.json({
    status: "QuietHelp backend running",
  });
});

// ---------------- ANALYZE ROUTE ----------------
app.post("/analyze", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Text is required",
      });
    }

    // ---------- Emergency keyword check ----------
    const emergencyWords = [
      "knife",
      "threaten",
      "kill",
      "hurt",
      "followed",
      "attack",
    ];

    const isEmergency = emergencyWords.some((word) =>
      text.toLowerCase().includes(word)
    );

    if (isEmergency) {
      return res.json({
        success: true,
        data: {
          incident_type: "Potential Danger",
          urgency: "High",
          emotion: "Fear",
          summary:
            "This situation may involve immediate risk based on the description.",
          guidance: [
            "Please move to a safe place if possible",
            "Consider contacting local emergency services",
            "Reach out to a trusted person for help",
          ],
        },
      });
    }

    // ---------- AI PROMPT ----------
    const prompt = `
You are an AI assistant designed ONLY for analyzing women's safety incident reports.

STRICT RULES:
- You must ONLY analyze the incident provided.
- You must NOT answer unrelated questions.
- You must NOT provide legal advice.
- You must NOT mention police, laws, or authorities.
- You must NOT include opinions or explanations.
- You must ONLY return valid JSON.
- If input is not a valid incident, write in summary:
  "Please describe a valid safety-related situation."

TASKS:
1. Identify incident_type (Harassment, Stalking, Verbal Abuse, Safe, Other)
2. Identify urgency (Low, Medium, High)
3. Identify emotion (Fear, Anxiety, Anger, Neutral, Other)
4. Write a neutral 1–2 sentence summary
5. Provide supportive, non-judgmental guidance (max 3 points)

INCIDENT:
"${text}"

OUTPUT FORMAT (STRICT JSON):
{
  "incident_type": "",
  "urgency": "",
  "emotion": "",
  "summary": "",
  "guidance": []
}
`;

    // ---------- CALL GEMINI ----------
    const result = await model.generateContent(prompt);
    let aiText = result.response.text();

    // ---------- CLEAN & PARSE JSON ----------
    aiText = aiText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch (err) {
      console.error("❌ JSON parse failed:", aiText);
      return res.status(500).json({
        success: false,
        error: "AI returned invalid format",
      });
    }

    // ---------- SUCCESS ----------
    res.json({
      success: true,
      data: parsed,
    });
  } catch (err) {
    console.error("❌ Gemini error:", err.message);

    // ---------- SAFE FALLBACK ----------
    res.json({
      success: false,
      data: {
        incident_type: "Unavailable",
        urgency: "Unknown",
        emotion: "Unknown",
        summary: "AI service is temporarily unavailable.",
        guidance: [
          "Please try again later",
          "Ensure you are in a safe place",
          "Reach out to a trusted person if needed",
        ],
      },
    });
  }
});

// ---------------- START SERVER ----------------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
