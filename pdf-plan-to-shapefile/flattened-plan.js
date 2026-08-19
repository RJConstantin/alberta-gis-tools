import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
import { createWorker } from 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
let ocrRunning = false;
let flattenedMode = false;
let currentLegal = null;

function injectStyles() {
  if (document.getElementById('flattenedPlanStyles')) return;
  const style = document.createElement('style');
  style.id = 'flattenedPlanStyles';
  style.textContent = `
    .flattened-only{display:none}
    body.flattened-plan-mode .flattened-only{display:block}
    body.flattened-plan-mode .flattened-coordinate-row{display:none!important}
    .position-panel{margin:18px 0 0;border:1px solid #cdddeb;background:#f4f8fc;border-radius:10px;padding:16px}
    .position-panel h3{margin:4px 0 6px;font:700 17px/1.25 Arial,Helvetica,sans-serif;color:#172229}
    .position-panel p{margin:0 0 13px;color:#61717d;font-size:11px;line-height:1.5}
    .move-layout{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center}
    .move-pad{display:grid;grid-template-columns:42px 42px 42px;grid-template-rows:38px 38px 38px;gap:5px;justify-content:start}
    .move-pad button,.rotate-controls button{border:1px solid #b9ccdd;background:#fff;color:#2463a0;border-radius:6px;font:700 15px Arial,Helvetica,sans-serif;cursor:pointer}
    .move-pad button:hover,.rotate-controls button:hover{background:#eaf2f9}
    .move-pad .north{grid-column:2;grid-row:1}.move-pad .west{grid-column:1;grid-row:2}.move-pad .centre{grid-column:2;grid-row:2;color:#6c7d89;font-size:10px;cursor:default}.move-pad .east{grid-column:3;grid-row:2}.move-pad .south{grid-column:2;grid-row:3}
    .move-options{display:grid;gap:10px;min-width:220px}.move-options label{display:grid;gap:5px;color:#536675;font-size:11px;font-weight:700}.move-options select{height:35px;border:1px solid #c8d6e1;border-radius:6px;background:#fff;padding:0 8px;color:#172229}
    .rotate-controls{display:flex;gap:6px;flex-wrap:wrap}.rotate-controls button{padding:8px 10px;font-size:11px}
    .flattened-note{margin-top:12px;padding-top:11px;border-top:1px solid #d9e5ef;color:#677784;font-size:10px;line-height:1.45}
    @media(max-width:700px){.move-layout{grid-template-columns:1fr}.move-options{min-width:0}}
  `;
  document.head.appendChild(style);
}

function markCoordinateRow() {
  const lat = $('latInput');
  if (!lat) return;
  const row = lat.closest('.two-fields');
  if (row) row.classList.add('flattened-coordinate-row');
}

function ensurePositionPanel() {
  if ($('flattenedPositionPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'flattenedPositionPanel';
  panel.className = 'position-panel flattened-only';
  panel.innerHTML = `
    <div class="step-label">Position flattened plan</div>
    <h3>Move the whole pad to the correct spot.</h3>
    <p>The legal location only gets you to the correct LSD. The pad starts near the middle as a placeholder. Use the arrows to move the entire pad while comparing it with the plan, imagery and ATS grid.</p>
    <div class="move-layout">
      <div class="move-pad" aria-label="Move whole pad">
        <button type="button" class="north" data-move="north" title="Move north">↑</button>
        <button type="button" class="west" data-move="west" title="Move west">←</button>
        <button type="button" class="centre" tabindex="-1" aria-hidden="true">PAD</button>
        <button type="button" class="east" data-move="east" title="Move east">→</button>
        <button type="button" class="south" data-move="south" title="Move south">↓</button>
      </div>
      <div class="move-options">
        <label>Move each click
          <select id="moveStep">
            <option value="10">10 m</option>
            <option value="25" selected>25 m</option>
            <option value="50">50 m</option>
            <option value="100">100 m</option>
          </select>
        </label>
        <div>
          <div style="color:#536675;font-size:11px;font-weight:700;margin-bottom:5px">Rotate whole pad</div>
          <div class="rotate-controls">
            <button type="button" data-rotate="-1">−1°</button>
            <button type="button" data-rotate="-0.1">−0.1°</button>
            <button type="button" data-rotate="0.1">+0.1°</button>
            <button type="button" data-rotate="1">+1°</button>
          </div>
        </div>
      </div>
    </div>
    <div class="flattened-note">The starting position is not treated as the final site location. Download remains locked until you confirm the boundary on the map.</div>
  `;
  const mapCard = document.querySelector('.map-card');
  if (mapCard) mapCard.insertAdjacentElement('beforebegin', panel);

  panel.querySelectorAll('[data-move]').forEach((button) => {
    button.addEventListener('click', () => movePad(button.dataset.move));
  });
  panel.querySelectorAll('[data-rotate]').forEach((button) => {
    button.addEventListener('click', () => rotatePad(Number(button.dataset.rotate)));
  });
}

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
  const focused = text.match(/(?:PAD\s*SITE|WELL\s*SITE|SITE|PAD)[^0-9]{0,45}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2,3})\s*-\s*(\d{1,2})/i);
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
  const patterns = [
    /\b(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)\s*[\"”″]?/g,
    /\b(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)/g,
  ];
  const bearings = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const bearing = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
      if (bearing >= 0 && bearing < 360) bearings.push(bearing);
    }
  }
  const candidates = bearings.map((bearing) => {
    const offsets = [bearing - 90, bearing - 270];
    const rotation = offsets.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    return { bearing, rotation };
  }).filter((x) => Math.abs(x.rotation) <= 45)
    .sort((a, b) => Math.abs(a.rotation) - Math.abs(b.rotation));
  return candidates[0] || null;
}

function ensureMeridianSelector(legal) {
  let row = $('ocrMeridianRow');
  if (row) row.remove();
  row = document.createElement('div');
  row.id = 'ocrMeridianRow';
  row.style.cssText = 'margin:10px 0 0;padding:10px 12px;border:1px solid #d7e2ec;border-radius:7px;background:#f7fafc;font:12px Arial,Helvetica,sans-serif;color:#536776;';
  row.innerHTML = '<strong>Meridian was not readable.</strong> Choose it to locate the LSD: <select id="ocrMeridian" style="margin-left:8px;padding:5px 7px;border:1px solid #c8d5df;border-radius:5px"><option value="">Select</option><option value="4">W4M</option><option value="5">W5M</option><option value="6">W6M</option></select>';
  $('detectedBox')?.insertAdjacentElement('afterend', row);
  $('ocrMeridian').addEventListener('change', (e) => {
    const mer = Number(e.target.value);
    if (!mer) return;
    legal.mer = mer;
    currentLegal = legal;
    setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}-W${mer}M`);
    locateAndCreateStartingPad();
  });
}

function renderOcrFindings(legal, dims, rotationInfo) {
  const lines = ['<strong>Flattened plan OCR results:</strong>'];
  if (legal) {
    const suffix = legal.mer ? `-W${legal.mer}M` : ' (choose meridian below)';
    lines.push(`Legal location: ${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}${suffix}`);
  }
  if (dims) lines.push(`Likely pad dimensions: ${dims.width} m × ${dims.height} m`);
  if (rotationInfo) lines.push(`Likely top-edge bearing: ${formatBearing(rotationInfo.bearing)} (starting rotation ${rotationInfo.rotation.toFixed(2)}°)`);
  if (!legal && !dims) lines.push('No reliable legal location or repeated site dimension was recognized.');
  lines.push('<span class="detected-note">OCR is approximate. The map confirmation is the final check.</span>');
  $('detectedBox').innerHTML = lines.join('<br>');
}

function formatBearing(value) {
  let d = Math.floor(value);
  const minFloat = (value - d) * 60;
  let m = Math.floor(minFloat);
  let s = Math.round((minFloat - m) * 60);
  if (s === 60) { s = 0; m += 1; }
  if (m === 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}\"`;
}

async function renderHighResolutionPage(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  const nativeText = textContent.items.map((item) => item.str).join(' ').trim();
  if (nativeText.length > 80) return { nativeText, canvas: null };

  const base = page.getViewport({ scale: 1 });
  const scale = 3200 / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise;
  return { nativeText, canvas };
}

function enterFlattenedMode() {
  flattenedMode = true;
  document.body.classList.add('flattened-plan-mode');
  markCoordinateRow();
  ensurePositionPanel();
  if ($('locatePlan')) $('locatePlan').textContent = 'Locate LSD';
  if ($('applyRectangle')) $('applyRectangle').textContent = 'Rebuild starting pad';
}

function resetFlattenedMode() {
  flattenedMode = false;
  currentLegal = null;
  document.body.classList.remove('flattened-plan-mode');
  $('ocrMeridianRow')?.remove();
  if ($('locatePlan')) $('locatePlan').textContent = 'Locate on map';
  if ($('applyRectangle')) $('applyRectangle').textContent = 'Build / reset rectangle';
}

async function locateAndCreateStartingPad() {
  if (!currentLegal?.mer) return;
  $('pdfStatus').textContent = 'Locating the correct LSD on the Alberta Township System…';
  $('locatePlan')?.click();

  const start = Date.now();
  const timer = setInterval(() => {
    const lat = Number($('latInput')?.value);
    const lon = Number($('lonInput')?.value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= 48 && lat <= 61 && lon >= -121 && lon <= -109) {
      clearInterval(timer);
      if ($('widthInput')?.value && $('heightInput')?.value) {
        $('applyRectangle')?.click();
        setTimeout(zoomOutForContext, 500);
        $('pdfStatus').textContent = 'LSD located and a starting pad has been created. The pad is only a placeholder. Use the arrows below to move the whole pad to its actual location, then confirm it on the map.';
      } else {
        $('pdfStatus').textContent = 'LSD located. Enter or correct the pad dimensions, then create the starting pad and position it on the map.';
      }
    } else if (Date.now() - start > 9000) {
      clearInterval(timer);
    }
  }, 200);
}

function zoomOutForContext() {
  const zoomOut = document.querySelector('.leaflet-control-zoom-out');
  if (!zoomOut) return;
  zoomOut.click();
  setTimeout(() => zoomOut.click(), 80);
}

function offsetCoordinate(lat, lon, eastM, northM) {
  const r = 6378137;
  const dLat = northM / r;
  const dLon = eastM / (r * Math.cos(lat * Math.PI / 180));
  return [lat + dLat * 180 / Math.PI, lon + dLon * 180 / Math.PI];
}

function movePad(direction) {
  if (!flattenedMode) return;
  const lat = Number($('latInput')?.value);
  const lon = Number($('lonInput')?.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    $('pdfStatus').textContent = 'Locate the LSD first, then use the arrows to position the pad.';
    return;
  }
  const step = Number($('moveStep')?.value) || 25;
  let east = 0;
  let north = 0;
  if (direction === 'north') north = step;
  if (direction === 'south') north = -step;
  if (direction === 'east') east = step;
  if (direction === 'west') east = -step;
  const [newLat, newLon] = offsetCoordinate(lat, lon, east, north);
  setValue('latInput', newLat.toFixed(7));
  setValue('lonInput', newLon.toFixed(7));
  $('applyRectangle')?.click();
  setTimeout(zoomOutForContext, 350);
  $('pdfStatus').textContent = `Moved the whole pad ${step} m ${direction}. Continue positioning it, then confirm the final location on the map.`;
}

function rotatePad(delta) {
  if (!flattenedMode) return;
  const current = Number($('rotationInput')?.value) || 0;
  const next = current + delta;
  setValue('rotationInput', next.toFixed(2));
  if ($('widthInput')?.value && $('heightInput')?.value && $('latInput')?.value && $('lonInput')?.value) {
    $('applyRectangle')?.click();
    setTimeout(zoomOutForContext, 350);
  }
  $('pdfStatus').textContent = `Pad rotation set to ${next.toFixed(2)}°. Confirm it against the plan and imagery before download.`;
}

async function runOcrFallback(file) {
  if (ocrRunning || !file) return;
  ocrRunning = true;
  try {
    const { canvas } = await renderHighResolutionPage(file);
    if (!canvas) {
      resetFlattenedMode();
      return;
    }

    enterFlattenedMode();
    $('pdfConfidence').textContent = 'Flattened plan detected';
    $('pdfStatus').textContent = 'No usable PDF text layer was found. Reading the plan image…';

    const worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && Number.isFinite(m.progress)) {
          $('pdfStatus').textContent = `Reading flattened plan… ${Math.round(m.progress * 100)}%`;
        }
      }
    });
    await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    const result = await worker.recognize(canvas);
    await worker.terminate();

    const text = cleanText(result?.data?.text || '');
    const legal = detectLegal(text);
    const dims = detectDimensions(text);
    const rotationInfo = detectRotation(text);
    currentLegal = legal;

    if (legal) {
      if (legal.mer) setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}-W${legal.mer}M`);
      else {
        setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}`);
        ensureMeridianSelector(legal);
      }
    }
    if (dims) {
      setValue('widthInput', dims.width);
      setValue('heightInput', dims.height);
    }
    if (rotationInfo && Math.abs(rotationInfo.rotation) > 0.02) {
      setValue('rotationInput', rotationInfo.rotation.toFixed(2));
    }

    renderOcrFindings(legal, dims, rotationInfo);
    $('pdfConfidence').textContent = legal || dims ? 'Flattened plan details found' : 'Manual positioning required';

    if (legal?.mer) {
      await locateAndCreateStartingPad();
    } else if (legal) {
      $('pdfStatus').textContent = 'The plan location was read, but the meridian was not clear. Choose W4M, W5M or W6M. The tool will then navigate to that LSD and create a movable starting pad.';
    } else {
      $('pdfStatus').textContent = 'The plan image was read, but the legal location was not reliable. Enter the LSD location from the plan, then choose Locate LSD. You can still position the whole pad with the simplified controls.';
    }
  } catch (err) {
    console.error('Flattened plan OCR failed', err);
    enterFlattenedMode();
    $('pdfStatus').textContent = `The flattened plan could not be read automatically: ${err.message || err}. Enter the LSD from the plan, click Locate LSD, then position the pad with the simplified controls.`;
    $('pdfConfidence').textContent = 'Manual LSD positioning available';
  } finally {
    ocrRunning = false;
  }
}

function handlePossibleFlattenedFile(file) {
  if (!file) return;
  resetFlattenedMode();
  setTimeout(() => runOcrFallback(file), 250);
}

injectStyles();
markCoordinateRow();
ensurePositionPanel();

const input = $('planPdfInput');
if (input) {
  input.addEventListener('change', (e) => handlePossibleFlattenedFile(e.target.files?.[0]));
}

const drop = $('planPdfDrop');
if (drop) {
  drop.addEventListener('drop', (e) => handlePossibleFlattenedFile(e.dataTransfer?.files?.[0]));
}
