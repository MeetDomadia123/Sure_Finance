import fs from "fs-extra";
import * as pdfParseNS from "pdf-parse";
import pdf2pic from "pdf2pic";
import { createWorker } from "tesseract.js";

const pdf =
  typeof pdfParseNS === "function"
    ? pdfParseNS
    : pdfParseNS.default || pdfParseNS.pdf;
const { fromPath } = pdf2pic;

export async function extractTextFromPDF(filePath, lang = "eng") {
  const dataBuffer = await fs.readFile(filePath);

  let pageCount = 1;
  try {
    const parsed = await pdf(dataBuffer);
    pageCount = parsed.numpages || 1;
    if (parsed.text && parsed.text.trim().length > 0) {
      return parsed.text;
    }
  } catch {}

  const converter = fromPath(filePath, {
    density: 260,
    saveFilename: "temp",
    savePath: "./temp",
    format: "png",
    width: 1700,
    height: 2200,
  });

  const worker = await createWorker();
  const canLoad = worker && typeof worker.loadLanguage === "function";
  const canInit = worker && typeof worker.initialize === "function";
  if (canLoad) await worker.loadLanguage(lang);
  if (canInit) await worker.initialize(lang);
  if (worker && typeof worker.setParameters === "function") {
    await worker.setParameters({ preserve_interword_spaces: "1" });
  }

  let images = [];
  try {
    if (!Number.isFinite(pageCount) || pageCount <= 1) {
      images = await converter.bulk(-1, false);
      pageCount = images.length || 1;
    } else {
      for (let i = 1; i <= pageCount; i++) images.push(await converter(i));
    }
  } catch {
    images = [await converter(1)];
    pageCount = 1;
  }

  let fullText = "";
  try {
    for (let i = 0; i < images.length; i++) {
      const page = images[i];
      let text = "";
      if (worker && typeof worker.recognize === "function") {
        const {
          data: { text: t },
        } = await worker.recognize(page.path);
        text = t;
      } else {
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
      try {
        if (page?.path) await fs.remove(page.path);
      } catch {}
    }
  } finally {
    if (worker && typeof worker.terminate === "function")
      await worker.terminate();
  }

  return fullText;
}


