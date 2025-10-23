import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { extractTextFromPDF } from "./src/extract.js";
import { parseByBank } from "./src/parsers/index.js";
import { chooseBestBankParse } from "./src/parsers/detect.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dirs
const tempDir = path.join(__dirname, "temp");
fs.ensureDirSync(tempDir);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ dest: tempDir });

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/parse", upload.single("pdf"), async (req, res) => {
  const bankSelected = String(req.body.bank || "").toLowerCase();
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  console.log(
    `POST /api/parse bankSelected=${bankSelected} file=${req.file.originalname} path=${req.file.path} size=${req.file.size}`
  );
  try {
    const text = await extractTextFromPDF(req.file.path, "eng");

    const result = chooseBestBankParse(text, bankSelected);

    res.json({
      bankSelected,
      bankDetected: result.bankDetected,
      bankUsed: result.bankUsed,
      detectionScore: result.detectionScore,
      detectionScores: result.detectionScores,
      parseScores: result.parseScores,
      parsed: result.parsed,
      textSample: text.slice(0, 1200),
    });
  } catch (e) {
    console.error("Parse error:", e);
    res.status(500).json({ error: e?.message || String(e) });
  } finally {
    try {
      await fs.remove(req.file.path);
    } catch {}
  }
});

process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
process.on("uncaughtException", (e) => console.error("uncaughtException", e));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Web UI at http://localhost:${port}`));
