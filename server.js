// server.js

import dotenv from "dotenv";
dotenv.config(); // Load env variables FIRST

import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

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

// ---------------- AUTHORITY AUTH MIDDLEWARE ----------------
function verifyAuthority(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "authority") {
      return res.status(403).json({ error: "Forbidden access" });
    }

    req.authority = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

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

    const emergencyWords = [
      "knife",
      "threaten",
      "kill",
      "hurt",
      "followed",
      "attack",
    ];

    const isEmergency = emergencyWords.some(word =>
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

    const prompt = `
You are an AI assistant designed ONLY for analyzing women's safety incident reports.

STRICT RULES:
- You must ONLY analyze the incident provided.
- You must NOT answer unrelated questions.
- You must NOT provide legal advice.
- You must NOT mention police, laws, or authorities.
- You must ONLY return valid JSON.

INCIDENT:
"${text}"

OUTPUT FORMAT:
{
  "incident_type": "",
  "urgency": "",
  "emotion": "",
  "summary": "",
  "guidance": []
}
`;

    const result = await model.generateContent(prompt);
    let aiText = result.response.text().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(aiText);

    res.json({ success: true, data: parsed });
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

// ---------------- PUBLIC STATS ROUTE ----------------
app.get("/stats", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("complaints")
      .select("type, incident_time");

    if (error) throw error;

    const total = data.length;
    const typeCount = {};
    const hourCount = Array(24).fill(0);

    data.forEach(row => {
      if (row.type) typeCount[row.type] = (typeCount[row.type] || 0) + 1;
      if (row.incident_time) {
        hourCount[new Date(row.incident_time).getHours()]++;
      }
    });

    res.json({ total, typeCount, hourCount });
  } catch (err) {
    console.error("❌ Stats error:", err.message);
    res.status(500).json({ error: "Stats unavailable" });
  }
});

// ---------------- AUTHORITY LOGIN (DEMO) ----------------
app.post("/authority/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const { data, error } = await supabase
      .from("authority_users")
      .select("*")
      .eq("email", email)
      .limit(1);

    if (error || !data || data.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = data[0];

    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        authority_id: user.id,
        role: "authority",
        organization: user.organization,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ success: true, token });
  } catch (err) {
    console.error("❌ Authority login error:", err.message);
    res.status(500).json({ error: "Authority login failed" });
  }
});

// ---------------- AUTHORITY STATS (PROTECTED) ----------------
app.get("/authority/stats", verifyAuthority, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("complaints")
      .select("type, created_at, visibility, ai_analysis,location")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const authorityComplaints = [];
    const awarenessComplaints = [];
    const authorityTypeCount = {};
    const awarenessTypeCount = {};

    data.forEach(row => {
      let summary = "AI summary not available";

      if (row.ai_analysis && typeof row.ai_analysis === "object") {
        summary = row.ai_analysis.summary || summary;
      }

      const item = {
  type: row.type || "Unknown",
  time: row.created_at,
  summary,
  location: row.location || null
};


      if (row.visibility === "authority") {
        authorityComplaints.push(item);
        authorityTypeCount[item.type] =
          (authorityTypeCount[item.type] || 0) + 1;
      }

      if (row.visibility === "awareness") {
        awarenessComplaints.push(item);
        awarenessTypeCount[item.type] =
          (awarenessTypeCount[item.type] || 0) + 1;
      }
    });

    res.json({
      authority: {
        count: authorityComplaints.length,
        complaints: authorityComplaints.slice(0, 5),
        typeCount: authorityTypeCount
      },
      awareness: {
        count: awarenessComplaints.length,
        complaints: awarenessComplaints.slice(0, 5),
        typeCount: awarenessTypeCount
      }
    });

  } catch (err) {
    console.error("❌ Authority stats error:", err.message);
    res.status(500).json({ error: "Failed to load authority stats" });
  }
});

// ---------------- START SERVER ----------------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
