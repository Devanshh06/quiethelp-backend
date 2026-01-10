// server.js

import dotenv from "dotenv";
dotenv.config(); // Load env variables FIRST

import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
// ---------------- BASIC SETUP ----------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---------------- SUPABASE SETUP (SERVER ONLY) ----------------
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Supabase environment variables missing");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ SERVER ONLY
);

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
  res.json({ status: "QuietHelp backend running" });
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

    const result = await model.generateContent(prompt);
    let aiText = result.response.text();

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

    res.json({
      success: true,
      data: parsed,
    });
  } catch (err) {
    console.error("❌ Gemini error:", err.message);
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

// ---------------- STATS ROUTE (AI-ANALYSIS PAGE) ----------------
app.get("/stats", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("complaints")
      .select("type, incident_time");

    if (error) throw error;

    const total = data.length;
    const typeCount = {};
    const hourCount = Array(24).fill(0);

    data.forEach((row) => {
      if (row.type) {
        typeCount[row.type] = (typeCount[row.type] || 0) + 1;
      }
      if (row.incident_time) {
        const hour = new Date(row.incident_time).getHours();
        hourCount[hour]++;
      }
    });

    res.json({
      total,
      typeCount,
      hourCount,
    });
  } catch (err) {
    console.error("❌ Stats error:", err.message);
    res.status(500).json({ error: "Stats unavailable" });
  }
});
// ---------------- AUTHORITY LOGIN (DEMO) ----------------
app.post("/authority/login", async (req, res) => {
  try {
    // 1. Read data sent by frontend
    const { email, password } = req.body;

    // 2. Validate input
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    // 3. Fetch authority user from Supabase
    const { data, error } = await supabase
      .from("authority_users")
      .select("*")
      .eq("email", email)
      .single();

    // 4. If user not found
    if (error || !data) {
      return res.status(401).json({
        error: "Invalid credentials"
      });
    }

    // 5. Check password (demo logic)
    if (data.password !== password) {
      return res.status(401).json({
        error: "Invalid credentials"
      });
    }

    // 6. Create signed JWT token
    const token = jwt.sign(
      {
        authority_id: data.id,
        role: "authority",
        organization: data.organization
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    // 7. Send token to frontend
    res.json({
      success: true,
      token
    });

  } catch (err) {
    console.error("Authority login error:", err.message);
    res.status(500).json({
      error: "Authority login failed"
    });
  }
});

// ---------------- START SERVER ----------------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
