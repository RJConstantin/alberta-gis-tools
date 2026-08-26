(() => {
  "use strict";

  const el = id => document.getElementById(id);
  const state = { workbook:null, matrix:[], headers:[], rows:[], source:"file" };

  const tabFile = el("tab-file");
  const tabPaste = el("tab-paste");
  const filePanel = el("file-panel");
  const pastePanel = el("paste-panel");
  const fileInput = el("file-input");
  const sheetRow = el("sheet-row");
  const sheetSelect = el("sheet-select");
  const fileHeader = el("file-header");
  const pasteHeader = el("paste-header");
  const pasteInput = el("paste-input");
  const readPaste = el("read-paste");
  const inputStatus = el("input-status");
  const mappingCard = el("mapping-card");
  const exportCard = el("export-card");
  const xField = el("x-field");
  const yField = el("y-field");
  const crsSelect = el("crs-select");
  const crsNote = el("crs-note");
  const fieldList = el("field-list");
  const previewWrap = el("preview-wrap");
  const outputName = el("output-name");
  const exportButton = el("export-button");
  const exportStatus = el("export-status");

  function setStatus(target, message, type="") {
    target.className = "status" + (type ? " " + type : "");
    target.textContent = message;
  }

  function switchSource(source) {
    state.source = source;
    const isFile = source === "file";
    tabFile.classList.toggle("active", isFile);
    tabPaste.classList.toggle("active", !isFile);
    filePanel.classList.toggle("hidden", !isFile);
    pastePanel.classList.toggle("hidden", isFile);
  }

  function populateCRS() {
    crsSelect.innerHTML = "";
    AGIS_CRS.list.forEach(crs => {
      const option = document.createElement("option");
      option.value = crs.id;
      option.textContent = `${crs.label} (${crs.id.replace("EPSG:","EPSG ")})`;
      if (crs.id === "EPSG:3400") option.selected = true;
      crsSelect.appendChild(option);
    });
    updateCRSNote();
  }

  function updateCRSNote() {
    const crs = AGIS_CRS.get(crsSelect.value);
    crsNote.textContent = `Coordinates will be written exactly as supplied and the shapefile will be defined as ${crs.label}. Units: ${crs.unit}.`;
  }

  function uniqueHeaders(values) {
    const used = new Map();
    return values.map((value, i) => {
      let base = String(value ?? "").trim();
      if (!base) base = `Field${i + 1}`;
      const count = used.get(base.toLowerCase()) || 0;
      used.set(base.toLowerCase(), count + 1);
      return count ? `${base}_${count + 1}` : base;
    });
  }

  function matrixToRows(matrix, hasHeader) {
    const cleaned = matrix
      .filter(row => Array.isArray(row) && row.some(v => String(v ?? "").trim() !== ""))
      .map(row => row.map(v => v ?? ""));
    if (!cleaned.length) throw new Error("No rows were found.");

    const width = Math.max(...cleaned.map(r => r.length));
    cleaned.forEach(r => { while (r.length < width) r.push(""); });

    const headerValues = hasHeader ? cleaned[0] : Array.from({length:width}, (_,i) => `Field${i+1}`);
    const headers = uniqueHeaders(headerValues);
    const dataRows = hasHeader ? cleaned.slice(1) : cleaned;
    if (!dataRows.length) throw new Error("The table has field names but no data rows.");

    const rows = dataRows.map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i] ?? "");
      return obj;
    });

    state.matrix = cleaned;
    state.headers = headers;
    state.rows = rows;
    renderLoadedData();
  }

  function autoField(kind) {
    const exactX = ["x","easting","east","longitude","long","lon"];
    const exactY = ["y","northing","north","latitude","lat"];
    const containsX = ["easting","longitude"];
    const containsY = ["northing","latitude"];
    const names = state.headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g,""));
    const exact = kind === "x" ? exactX : exactY;
    const contains = kind === "x" ? containsX : containsY;

    for (let i=0;i<names.length;i++) if (exact.includes(names[i])) return state.headers[i];
    for (let i=0;i<names.length;i++) if (contains.some(k => names[i].includes(k))) return state.headers[i];

    const numericScores = state.headers.map(h => {
      let n=0, valid=0;
      state.rows.slice(0,25).forEach(row => {
        const value = parseNumber(row[h]);
        if (Number.isFinite(value)) valid++;
        n++;
      });
      return n ? valid/n : 0;
    });
    const candidates = numericScores
      .map((score,i)=>({score,i}))
      .filter(o=>o.score>.7)
      .sort((a,b)=>b.score-a.score);
    if (!candidates.length) return state.headers[kind === "x" ? 0 : Math.min(1,state.headers.length-1)];
    if (kind === "x") return state.headers[candidates[0].i];
    return state.headers[(candidates[1] || candidates[0]).i];
  }

  function renderLoadedData() {
    if (!state.headers.length || !state.rows.length) return;

    [xField, yField].forEach(select => {
      select.innerHTML = "";
      state.headers.forEach(h => {
        const option = document.createElement("option");
        option.value = h;
        option.textContent = h;
        select.appendChild(option);
      });
    });
    xField.value = autoField("x");
    yField.value = autoField("y");

    fieldList.innerHTML = "";
    state.headers.forEach(h => {
      const label = document.createElement("label");
      label.className = "check";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.value = h;
      check.dataset.field = "1";
      const span = document.createElement("span");
      span.textContent = h;
      span.title = h;
      label.append(check, span);
      fieldList.appendChild(label);
    });

    renderPreview();
    mappingCard.classList.remove("hidden");
    exportCard.classList.remove("hidden");
    setStatus(inputStatus, `${state.rows.length.toLocaleString()} data row${state.rows.length===1?"":"s"} loaded with ${state.headers.length} field${state.headers.length===1?"":"s"}.`, "success");
    setStatus(exportStatus, "Ready to create the shapefile.");
  }

  function renderPreview() {
    const headers = state.headers;
    const rows = state.rows.slice(0,10);
    let html = "<table><thead><tr>" + headers.map(h => `<th>${escapeHTML(h)}</th>`).join("") + "</tr></thead><tbody>";
    rows.forEach(row => {
      html += "<tr>" + headers.map(h => `<td title="${escapeHTML(String(row[h] ?? ""))}">${escapeHTML(String(row[h] ?? ""))}</td>`).join("") + "</tr>";
    });
    html += "</tbody></table>";
    if (state.rows.length > 10) html += `<div class="note" style="padding:8px 10px">Previewing the first 10 of ${state.rows.length.toLocaleString()} rows.</div>`;
    previewWrap.innerHTML = html;
  }

  function escapeHTML(value) {
    return value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function parseNumber(value) {
    if (typeof value === "number") return value;
    const cleaned = String(value ?? "").trim().replace(/,/g,"");
    if (!cleaned) return NaN;
    return Number(cleaned);
  }

  function selectedFields() {
    return Array.from(fieldList.querySelectorAll('input[data-field="1"]:checked')).map(c => c.value);
  }

  function safeFileName(name) {
    return String(name || "points")
      .trim()
      .replace(/\.(zip|shp)$/i,"")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g,"_")
      .replace(/\s+$/,"")
      .slice(0,80) || "points";
  }

  function makeDbfMap(fields) {
    const used = new Set();
    const map = new Map();
    fields.forEach((field, index) => {
      let base = String(field).replace(/[^A-Za-z0-9_]/g,"_");
      if (!base) base = `FIELD${index+1}`;
      if (/^[0-9]/.test(base)) base = "F_" + base;
      base = base.slice(0,10);
      let key = base;
      let n = 2;
      while (used.has(key.toUpperCase())) {
        const suffix = String(n++);
        key = base.slice(0,10-suffix.length) + suffix;
      }
      used.add(key.toUpperCase());
      map.set(field,key);
    });
    return map;
  }

  async function readWorkbookFile(file) {
    if (!file) return;
    setStatus(inputStatus, `Reading ${file.name}...`);
    try {
      const buffer = await file.arrayBuffer();
      state.workbook = XLSX.read(buffer, {type:"array", cellDates:true});
      sheetSelect.innerHTML = "";
      state.workbook.SheetNames.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        sheetSelect.appendChild(option);
      });
      sheetRow.classList.remove("hidden");
      loadSelectedSheet();
      const base = file.name.replace(/\.[^.]+$/,"");
      if (base) outputName.value = base;
    } catch (err) {
      mappingCard.classList.add("hidden");
      exportCard.classList.add("hidden");
      setStatus(inputStatus, `Could not read the file: ${err.message}`, "error");
    }
  }

  function loadSelectedSheet() {
    if (!state.workbook) return;
    try {
      const sheet = state.workbook.Sheets[sheetSelect.value || state.workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(sheet, {header:1, defval:"", raw:false, blankrows:false});
      matrixToRows(matrix, fileHeader.value === "yes");
    } catch (err) {
      setStatus(inputStatus, err.message, "error");
    }
  }

  function parsePastedText() {
    const text = pasteInput.value.trim();
    if (!text) {
      setStatus(inputStatus, "Paste some point rows first.", "error");
      return;
    }
    try {
      let matrix;
      const firstLine = text.split(/\r?\n/).find(line => line.trim()) || "";
      if (firstLine.includes("\t")) {
        matrix = text.split(/\r?\n/).filter(Boolean).map(line => line.split("\t"));
      } else if (firstLine.includes(",")) {
        const wb = XLSX.read(text, {type:"string"});
        matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, defval:"", raw:false, blankrows:false});
      } else {
        matrix = text.split(/\r?\n/).filter(line=>line.trim()).map(line => line.trim().split(/\s+/));
      }
      matrixToRows(matrix, pasteHeader.value === "yes");
      if (outputName.value === "points") outputName.value = "pasted_points";
    } catch (err) {
      mappingCard.classList.add("hidden");
      exportCard.classList.add("hidden");
      setStatus(inputStatus, `Could not read the pasted table: ${err.message}`, "error");
    }
  }

  async function exportShapefile() {
    if (!state.rows.length) return;
    if (xField.value === yField.value) {
      setStatus(exportStatus, "X and Y cannot use the same field.", "error");
      return;
    }
    const keep = selectedFields();
    const dbfMap = makeDbfMap(keep);
    const features = [];
    let skipped = 0;

    state.rows.forEach(row => {
      const x = parseNumber(row[xField.value]);
      const y = parseNumber(row[yField.value]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        skipped++;
        return;
      }
      const properties = {};
      keep.forEach(field => {
        let value = row[field];
        if (value instanceof Date) value = value.toISOString();
        if (value === undefined || value === null) value = "";
        properties[dbfMap.get(field)] = value;
      });
      features.push({
        type:"Feature",
        geometry:{type:"Point",coordinates:[x,y]},
        properties
      });
    });

    if (!features.length) {
      setStatus(exportStatus, `No valid numeric coordinates were found in ${xField.value} and ${yField.value}.`, "error");
      return;
    }

    const crs = AGIS_CRS.get(crsSelect.value);
    const name = safeFileName(outputName.value);
    outputName.value = name;
    exportButton.disabled = true;
    setStatus(exportStatus, `Creating ${features.length.toLocaleString()} point feature${features.length===1?"":"s"}...`);

    try {
      const fc = {type:"FeatureCollection",features};
      const result = await Promise.resolve(shpwrite.zip(fc, {
        outputType:"blob",
        prj:crs.wkt,
        folder:name,
        filename:name,
        types:{point:name,polygon:name+"_poly",polyline:name+"_line"}
      }));
      const blob = result instanceof Blob ? result : new Blob([result], {type:"application/zip"});
      downloadBlob(blob, `${name}.zip`);
      let msg = `${features.length.toLocaleString()} point feature${features.length===1?"":"s"} exported as ${name}.zip using ${crs.label}.`;
      if (skipped) msg += ` ${skipped.toLocaleString()} row${skipped===1?" was":"s were"} skipped because X or Y was blank or non-numeric.`;
      setStatus(exportStatus, msg, skipped ? "warning" : "success");
    } catch (err) {
      setStatus(exportStatus, `The shapefile could not be created: ${err.message}`, "error");
    } finally {
      exportButton.disabled = false;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  tabFile.addEventListener("click", () => switchSource("file"));
  tabPaste.addEventListener("click", () => switchSource("paste"));
  fileInput.addEventListener("change", () => readWorkbookFile(fileInput.files[0]));
  sheetSelect.addEventListener("change", loadSelectedSheet);
  fileHeader.addEventListener("change", loadSelectedSheet);
  readPaste.addEventListener("click", parsePastedText);
  pasteHeader.addEventListener("change", () => { if (pasteInput.value.trim()) parsePastedText(); });
  crsSelect.addEventListener("change", updateCRSNote);
  el("select-all").addEventListener("click", () => fieldList.querySelectorAll('input[data-field="1"]').forEach(c => c.checked=true));
  el("select-none").addEventListener("click", () => fieldList.querySelectorAll('input[data-field="1"]').forEach(c => c.checked=false));
  exportButton.addEventListener("click", exportShapefile);

  populateCRS();
})();
