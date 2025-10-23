import fs from "fs-extra";
import * as pdfParseNS from "pdf-parse";
import pdf2pic from "pdf2pic";
import { createWorker } from "tesseract.js";
import { parseStatementText } from "./parser.js";


const pdf =
  typeof pdfParseNS === "function"
    ? pdfParseNS
    : pdfParseNS.default || pdfParseNS.pdf;
const { fromPath } = pdf2pic;

async function extractTextFromPDF(filePath, lang = "eng") {
  const dataBuffer = await fs.readFile(filePath);

  // Try normal text extraction first and get page count if possible
  let pageCount = 1;
  try {
    const parsed = await pdf(dataBuffer);
    pageCount = parsed.numpages || 1;
    if (parsed.text && parsed.text.trim().length > 0) {
      console.log(
        `✅ Text extracted (no OCR) from ${filePath} (${pageCount} page${
          pageCount > 1 ? "s" : ""
        })`
      );
      return parsed.text;
    }
    console.log("ℹ️ PDF text empty, falling back to OCR…");
  } catch {
    console.log("⚠️ pdf-parse failed, trying OCR…");
  }

  // OCR path
  console.log(
    `🧠 OCR mode for ${filePath} (${pageCount} page${pageCount > 1 ? "s" : ""})`
  );
  const converter = fromPath(filePath, {
    density: 220,
    saveFilename: "temp",
    savePath: "./temp",
    format: "png",
    width: 1600,
    height: 2200,
  });

  const worker = await createWorker();

  // v5 has loadLanguage + initialize, v6 may not. Make it compatible.
  const canLoad = worker && typeof worker.loadLanguage === "function";
  const canInit = worker && typeof worker.initialize === "function";
  if (canLoad) await worker.loadLanguage(lang);
  if (canInit) await worker.initialize(lang);
  if (worker && typeof worker.setParameters === "function") {
    await worker.setParameters({ preserve_interword_spaces: "1" });
  }

  // Convert images for all pages: if pageCount unknown, use bulk()
  let images = [];
  try {
    if (!Number.isFinite(pageCount) || pageCount <= 1) {
      console.log("🧩 Page count unknown -> converting all pages via bulk()");
      images = await converter.bulk(-1, false); // all pages to files
      pageCount = images.length || 1;
    } else {
      for (let i = 1; i <= pageCount; i++) {
        images.push(await converter(i));
      }
    }
  } catch (e) {
    console.log(
      "⚠️ Image conversion failed, trying first page only…",
      e?.message || e
    );
    images = [await converter(1)];
    pageCount = images.length;
  }

  let fullText = "";
  try {
    for (let i = 0; i < images.length; i++) {
      const page = images[i];
      console.log(`🔎 OCR page ${i + 1}/${pageCount}…`);

      let text = "";
      if (worker && typeof worker.recognize === "function") {
        const {
          data: { text: t },
        } = await worker.recognize(page.path);
        text = t;
      } else {
        // Fallback for v6+: direct recognize API
        const T = await import("tesseract.js");
        const recognizeFn = T.recognize || (T.default && T.default.recognize);
        const {
          data: { text: t },
        } = await recognizeFn(page.path, lang, {
          preserve_interword_spaces: 1,
        });
        text = t;
      }

      fullText += text + "\n";
    }
  } finally {
    if (worker && typeof worker.terminate === "function") {
      await worker.terminate();
    }
  }

  return fullText;
}

async function main() {
  try {
    // CLI: node index.js [inputDir] [outputDir] [lang]
    const inputDir = process.argv[2] || "./samples";
    const outputDir = process.argv[3] || "./outputs";
    const lang = process.argv[4] || "eng";

    await fs.ensureDir(inputDir);
    await fs.ensureDir(outputDir);
    await fs.ensureDir("./temp");
    await fs.emptyDir("./temp"); // clean temp before run

    const files = (await fs.readdir(inputDir)).filter((f) =>
      f.toLowerCase().endsWith(".pdf")
    );

    if (files.length === 0) {
      console.log(`No PDF files found in ${inputDir}`);
      return;
    }

    for (const file of files) {
      const srcPath = `${inputDir}/${file}`;
      try {
        console.log(`\n📄 Processing: ${srcPath}`);
        const text = await extractTextFromPDF(srcPath, lang);
        const base = file.replace(/\.pdf$/i, "");
        const txtOut = `${outputDir}/${base}.txt`;
        await fs.writeFile(txtOut, text, "utf-8");
        console.log(`💾 Saved text to ${txtOut}`);

        // Parse key fields (Step 3)
        const parsed = parseStatementText(text);
        await fs.ensureDir(`${outputDir}/parsed`);
        const jsonOut = `${outputDir}/parsed/${base}.json`;
        await fs.writeFile(jsonOut, JSON.stringify(parsed, null, 2), "utf-8");
        console.log(`🧾 Saved parsed JSON to ${jsonOut}`);
      } catch (error) {
        console.error(`❌ Error processing ${file}:`, error?.message || error);
      }
    }
  } catch (error) {
    console.error("❌ Main error:", error?.message || error);
  }
}

main();
