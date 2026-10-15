const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");

const statuses = new Set(["complete", "partial", "unknown"]);
function presentationStatus(value = "unknown") {
  if (!statuses.has(value))
    throw new Error("Invalid presentation completion status.");
  return value;
}

// Small model outputs need no additional inference: retain the words, use explicit
// headings when present, otherwise paginate sentences and paragraphs in order.
function presentationSlides(content) {
  if (
    typeof content !== "string" ||
    !content.isWellFormed() ||
    content.length > 100_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(content)
  )
    throw new Error(
      "Invalid presentation text. No PowerPoint file was created.",
    );
  let text = content.trim();
  if (/^\s*error\s*:/i.test(text)) throw new Error(text);
  if (/^```/.test(text)) {
    if (!/^```(?:text|markdown|md)?\s*\r?\n/i.test(text))
      throw new Error(
        "Unsupported presentation format. Expected text or Markdown.",
      );
    text = text.replace(/^```[^\n]*\n/, "").replace(/\n```\s*$/, "");
  }
  if (!/[\p{L}\p{N}]/u.test(text) || /^\{/.test(text))
    throw new Error(
      "No usable presentation text. No PowerPoint file was created.",
    );
  const sections = [];
  let section = { title: "Presentation", points: [] };
  function flush() {
    if (section.points.length || section.title !== "Presentation")
      sections.push(section);
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:---+|\*\*\*+)\s*$/.test(trimmed)) continue;
    const heading =
      trimmed.match(/^#{1,6}\s+(.+)$/) ||
      trimmed.match(/^(Slide\s+\d+(?:\s*[:.\-–—]\s*.*)?)$/i) ||
      trimmed.match(/^\*\*(.+)\*\*$/);
    if (heading && heading[1].length <= 120) {
      flush();
      section = { title: heading[1], points: [] };
      continue;
    }
    const paragraph = trimmed.replace(/^(?:[-*+•]\s+|\d+[.)]\s+)/, "");
    for (const sentence of paragraph.split(
      /(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u,
    )) {
      // Bound each bullet so even a very long paragraph cannot overflow a slide.
      let point = "";
      for (const word of sentence.split(/\s+/)) {
        for (const part of word.match(/[\s\S]{1,220}/gu) || []) {
          if (point.length + part.length > 220) {
            section.points.push(point);
            point = "";
          }
          point += (point ? " " : "") + part;
        }
      }
      if (point) section.points.push(point);
    }
  }
  flush();
  const slides = [];
  for (const { title, points } of sections) {
    let page = [];
    const add = () => {
      slides.push({ title, points: page });
      page = [];
    };
    for (const point of points) {
      if (page.length >= 5 || page.join("").length + point.length > 650) add();
      page.push(point);
    }
    if (page.length || !points.length) add();
  }
  if (!slides.length || slides.length > 80)
    throw new Error(
      "Presentation output has no usable slides or exceeds the slide limit.",
    );
  return slides;
}

async function validatePptx(buffer, expectedSlides) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/slideMasters/slideMaster1.xml",
  ]) {
    if (!zip.file(name))
      throw new Error("PowerPoint package validation failed.");
  }
  const slides = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  );
  if (
    !slides.length ||
    (expectedSlides !== undefined && slides.length !== expectedSlides)
  )
    throw new Error("PowerPoint package has an invalid slide count.");
  const types = await zip.file("[Content_Types].xml").async("string");
  if (
    !types.includes(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    )
  )
    throw new Error("PowerPoint package has an invalid content type.");
  return zip;
}

async function createPresentation(content, status = "unknown") {
  presentationStatus(status);
  const slides = presentationSlides(content);
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "VIDUR AI";
  deck.subject = "Presentation structured from returned model text";
  deck.title = slides[0].title;
  deck.lang = "en-US";
  deck.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
  };
  const notice =
    status === "partial"
      ? "Partial model output — review before use"
      : status === "complete"
        ? "Model generation finished — review accuracy and coverage"
        : "Model completion status unverified — output may be partial";
  slides.forEach(({ title, points }, index) => {
    const slide = deck.addSlide();
    slide.background = { color: "F7F8FA" };
    slide.addText(title, {
      x: 0.7,
      y: 0.45,
      w: 11.9,
      h: 1.15,
      fontSize: 30,
      bold: true,
      color: "20262D",
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    let y = 1.85;
    for (const point of points) {
      const height = Math.max(0.48, Math.ceil(point.length / 75) * 0.38 + 0.13);
      slide.addText(point, {
        x: 0.85,
        y,
        w: 11.55,
        h: height,
        fontSize: 22,
        color: "303945",
        bullet: { indent: 20 },
        hanging: 4,
        margin: 0,
        valign: "top",
        fit: "shrink",
      });
      y += height + 0.12;
    }
    slide.addText(`${notice}  ·  ${index + 1}/${slides.length}`, {
      x: 0.7,
      y: 7.02,
      w: 11.9,
      h: 0.25,
      fontSize: 10,
      color: "606C78",
      margin: 0,
    });
    // Keep the exact original source available, including Markdown and fragments.
    slide.addNotes(content);
  });
  const buffer = await deck.write({
    outputType: "nodebuffer",
    compression: true,
  });
  await validatePptx(buffer, slides.length);
  return buffer;
}

module.exports = {
  createPresentation,
  presentationSlides,
  presentationStatus,
  validatePptx,
};
