import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
import { createWorker } from 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
let ocrRunning = false;

function cleanText(text) {
  return String(text || '')
    .replace(/[–—]/g, '-')
    .replace(/[|]/g, 'I')
    .replace(/\s+/g, ' ')
    .trim();
}

function setValue(id, value) {
  const el = $(id);
  if (!el || value == null || value === '') return;
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function detectMeridian(text) {
  const patterns = [
    /\bW\s*([456])\s*M\b/i,
    /\bWEST\s+OF\s+(?:THE\s+)?([456])(?:ST|ND|RD|TH)?\s+MERIDIAN\b/i,
    /\b([456])(?:ST|ND|RD|TH)\s+MERIDIAN\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function detectLegal(text) {
  const focused = text.match(/(?:PAD\s*SITE|WELL\s*SITE|SITE|PAD)[^0-9]{0,35}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2,3})\s*-\s*(\d{1,2})/i);
  const general = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2,3})\s*-\s*(\d{1,2})\b/);
  const m = focused || general;
  if (!m) return null;
  const legal = { lsd: Number(m[1]), sec: Number(m[2]), twp: Number(m[3]), rge: Number(m[4]) };
  if (legal.lsd < 1 || legal.lsd > 16 || legal.sec < 1 || legal.sec > 36 || legal.twp < 1 || legal.twp > 126 || legal.rge < 1 || legal.rge > 34) return null;
  legal.mer = detectMeridian(text);
  return legal;
}

function detectDimensions(text) {
  const numbers = [...text.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:M|METRES?)?\b/gi)]
    .map((m) => Number(m[1].replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v >= 20 && v <= 500);
  const buckets = new Map();
  for (const value of numbers) {
    const rounded = Math.round(value * 10) / 10;
    buckets.set(rounded, (buckets.get(rounded) || 0) + 1);
  }
  const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (!ranked.length) return null;
  const repeated = ranked.find(([, count]) => count >= 2);
  const primary = repeated?.[0] ?? ranked[0][0];
  return { width: primary, height: primary, count: repeated?.[1] || 1 };
}

function detectRotation(text) {
  const matches = [...text.matchAll(/\b(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*[\"”]?/g)];
  const candidates = matches.map((m) => Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600)
    .filter((v) => v >= 0 && v < 360)
    .map((bearing) => {
      const offsets = [bearing - 90, bearing - 270];
      const rotation = offsets.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      return { rotation };
    })
    .filter((x) => Math.abs(x.rotation) <= 45)
    .sort((a, b) => Math.abs(a.rotation) - Math.abs(b.rotation));
  return candidates[0]?.rotation ?? null;
}

function ensureMeridianSelector(legal) {
  let row = document.getElementById('ocrMeridianRow');
  if (row) return;
  row = document.createElement('div');
  row.id = 'ocrMeridianRow';
  row.style.cssText = 'margin:10px 0 0;padding:10px 12px;border:1px solid #d7e2ec;border-radius:7px;background:#f7fafc;font:12px Arial,Helvetica,sans-serif;color:#536776;';
  row.innerHTML = '<strong>Meridian was not readable.</strong> Choose it before locating the plan: <select id="ocrMeridian" style="margin-left:8px;padding:5px 7px;border:1px solid #c8d5df;border-radius:5px"><option value="">Select</option><option value="4">W4M</option><option value="5">W5M</option><option value="6">W6M</option></select>';
  $('detectedBox')?.insertAdjacentElement('afterend', row);
  document.getElementById('ocrMeridian').addEventListener('change', (e) => {
    const mer = Number(e.target.value);
    if (!mer) return;
    setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}-W${mer}M`);
    $('locatePlan')?.click();
    if ($('widthInput')?.value && $('heightInput')?.value) setTimeout(() => $('applyRectangle')?.click(), 900);
  });
}

function renderOcrFindings(legal, dims, rotation) {
  const lines = ['<strong>Flattened plan OCR results:</strong>'];
  if (legal) {
    const suffix = legal.mer ? `-W${legal.mer}M` : ' (meridian needs confirmation)';
    lines.push(`Legal location candidate: ${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}${suffix}`);
  }
  if (dims) lines.push(`Repeated plan dimension candidate: ${dims.width} m`);
  if (Number.isFinite(rotation)) lines.push(`Plan rotation candidate: ${rotation.toFixed(2)}°`);
  if (!legal && !dims) lines.push('No reliable legal location or repeated site dimension was recognized.');
  lines.push('<span class="detected-note">OCR is approximate. Confirm the final shape and location on the map before downloading.</span>');
  $('detectedBox').innerHTML = lines.join('<br>');
}

async function renderHighResolutionPage(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  const nativeText = textContent.items.map((item) => item.str).join(' ').trim();
  if (nativeText.length > 80) return { nativeText, canvas: null };

  const base = page.getViewport({ scale: 1 });
  const scale = 2800 / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise;
  return { nativeText, canvas };
}

async function runOcrFallback(file) {
  if (ocrRunning || !file) return;
  ocrRunning = true;
  try {
    const { canvas } = await renderHighResolutionPage(file);
    if (!canvas) return;

    $('pdfConfidence').textContent = 'Flattened plan detected';
    $('pdfStatus').textContent = 'No usable PDF text layer was found. Running OCR on the plan image…';

    const worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && Number.isFinite(m.progress)) {
          $('pdfStatus').textContent = `Reading flattened plan with OCR… ${Math.round(m.progress * 100)}%`;
        }
      }
    });
    await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    const result = await worker.recognize(canvas);
    await worker.terminate();

    const text = cleanText(result?.data?.text || '');
    const legal = detectLegal(text);
    const dims = detectDimensions(text);
    const rotation = detectRotation(text);

    if (legal) {
      if (legal.mer) setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}-W${legal.mer}M`);
      else {
        setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}`);
        ensureMeridianSelector(legal);
      }
    }
    if (dims) {
      if (!$('widthInput').value) setValue('widthInput', dims.width);
      if (!$('heightInput').value) setValue('heightInput', dims.height);
    }
    if (Number.isFinite(rotation) && Math.abs(rotation) > 0.05) setValue('rotationInput', rotation.toFixed(2));

    renderOcrFindings(legal, dims, rotation);
    $('pdfConfidence').textContent = legal || dims ? 'OCR plan details found' : 'Manual positioning required';

    if (legal?.mer) {
      $('pdfStatus').textContent = 'OCR found plan information. Locating the candidate area on the ATS map…';
      $('locatePlan')?.click();
      if (dims) setTimeout(() => $('applyRectangle')?.click(), 1000);
    } else if (legal) {
      $('pdfStatus').textContent = 'OCR found the legal location numbers, but not the meridian. Choose W4M, W5M, or W6M, then verify the location on the map.';
    } else {
      $('pdfStatus').textContent = 'OCR finished, but it could not confidently identify the legal location. You can still enter the legal location and draw or edit the boundary on the map.';
    }
  } catch (err) {
    console.error('Flattened plan OCR failed', err);
    $('pdfStatus').textContent = `Flattened-plan OCR could not finish: ${err.message || err}. You can still position and draw the boundary manually on the map.`;
    $('pdfConfidence').textContent = 'Manual positioning available';
  } finally {
    ocrRunning = false;
  }
}

const input = $('planPdfInput');
if (input) {
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTimeout(() => runOcrFallback(file), 250);
  });
}
