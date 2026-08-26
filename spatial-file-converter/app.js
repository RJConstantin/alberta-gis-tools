import shp from "https://unpkg.com/shpjs@6.2.0/dist/shp.esm.js";

const el = id => document.getElementById(id);
const state = { geojson:null, fields:[], sourceType:null, sourceName:"converted_data" };

const fileInput = el("file-input");
const inputStatus = el("input-status");
const inputSummary = el("input-summary");
const fieldsCard = el("fields-card");
const outputCard = el("output-card");
const fieldList = el("field-list");
const previewWrap = el("preview-wrap");
const outputFormat = el("output-format");
const outputName = el("output-name");
const nameFieldWrap = el("name-field-wrap");
const nameField = el("name-field");
const shpOptions = el("shp-options");
const crsSelect = el("crs-select");
const convertButton = el("convert-button");
const outputStatus = el("output-status");

function setStatus(target, message, type="") {
  target.className = "status" + (type ? " " + type : "");
  target.textContent = message;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function escapeXML(value) {
  return String(value ?? "").replace(/[<>&'"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]));
}

function safeFileName(name) {
  return String(name || "converted_data")
    .trim()
    .replace(/\.(zip|shp|kml|kmz|gpx)$/i,"")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g,"_")
    .replace(/\s+$/,"")
    .slice(0,80) || "converted_data";
}

function populateCRS() {
  crsSelect.innerHTML = "";
  AGIS_CRS.list.forEach(crs => {
    proj4.defs(crs.id, crs.proj4);
    const option = document.createElement("option");
    option.value = crs.id;
    option.textContent = `${crs.label} (${crs.id.replace("EPSG:","EPSG ")})`;
    if (crs.id === "EPSG:3400") option.selected = true;
    crsSelect.appendChild(option);
  });
}

function localName(node) {
  return (node.localName || node.nodeName || "").split(":").pop();
}

function directChildren(node, name) {
  return Array.from(node.children || []).filter(child => !name || localName(child) === name);
}

function firstDirect(node, name) {
  return directChildren(node, name)[0] || null;
}

function allByLocal(node, name) {
  return Array.from(node.getElementsByTagName("*")).filter(n => localName(n) === name);
}

function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error("The XML file could not be read.");
  return doc;
}

function parseCoordinateText(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.split(",").map(Number))
    .filter(c => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
}

function parseKmlGeometry(node) {
  const type = localName(node);

  if (type === "Point") {
    const coordinates = allByLocal(node,"coordinates")[0];
    const arr = parseCoordinateText(coordinates?.textContent)[0];
    return arr ? {type:"Point",coordinates:arr} : null;
  }

  if (type === "LineString" || type === "LinearRing") {
    const coordinates = allByLocal(node,"coordinates")[0];
    const arr = parseCoordinateText(coordinates?.textContent);
    return arr.length ? {type:"LineString",coordinates:arr} : null;
  }

  if (type === "Polygon") {
    const outer = allByLocal(node,"outerBoundaryIs")[0];
    const rings = [];
    if (outer) {
      const coords = allByLocal(outer,"coordinates")[0];
      const ring = parseCoordinateText(coords?.textContent);
      if (ring.length) rings.push(ring);
    }
    allByLocal(node,"innerBoundaryIs").forEach(inner => {
      const coords = allByLocal(inner,"coordinates")[0];
      const ring = parseCoordinateText(coords?.textContent);
      if (ring.length) rings.push(ring);
    });
    return rings.length ? {type:"Polygon",coordinates:rings} : null;
  }

  if (type === "Track") {
    const coords = allByLocal(node,"coord")
      .map(n => String(n.textContent || "").trim().split(/\s+/).map(Number))
      .filter(c => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    return coords.length ? {type:"LineString",coordinates:coords} : null;
  }

  if (type === "MultiGeometry" || type === "MultiTrack") {
    const geoms = directChildren(node)
      .map(parseKmlGeometry)
      .filter(Boolean);
    return geoms.length ? {type:"GeometryCollection",geometries:geoms} : null;
  }
  return null;
}

function parseKML(text) {
  const doc = parseXML(text);
  const placemarks = allByLocal(doc,"Placemark");
  const features = [];

  placemarks.forEach((pm, index) => {
    const properties = {};
    ["name","description"].forEach(tag => {
      const node = firstDirect(pm,tag);
      if (node && node.textContent.trim() !== "") properties[tag] = node.textContent.trim();
    });

    allByLocal(pm,"Data").forEach(data => {
      const key = data.getAttribute("name");
      const valueNode = allByLocal(data,"value")[0];
      if (key) properties[key] = valueNode ? valueNode.textContent : data.textContent;
    });
    allByLocal(pm,"SimpleData").forEach(data => {
      const key = data.getAttribute("name");
      if (key) properties[key] = data.textContent;
    });

    const geometryNodes = directChildren(pm).filter(n =>
      ["Point","LineString","Polygon","MultiGeometry","Track","MultiTrack"].includes(localName(n))
    );
    let geometry = null;
    if (geometryNodes.length === 1) geometry = parseKmlGeometry(geometryNodes[0]);
    else if (geometryNodes.length > 1) {
      const geometries = geometryNodes.map(parseKmlGeometry).filter(Boolean);
      if (geometries.length) geometry = {type:"GeometryCollection",geometries};
    }
    if (geometry) {
      features.push({type:"Feature",properties,geometry,id:index+1});
    }
  });

  if (!features.length) throw new Error("No supported KML features were found.");
  return {type:"FeatureCollection",features};
}

function gpxProperties(node) {
  const props = {};
  ["name","cmt","desc","src","time","sym","type"].forEach(tag => {
    const child = firstDirect(node,tag);
    if (child && child.textContent.trim() !== "") props[tag] = child.textContent.trim();
  });
  const link = firstDirect(node,"link");
  if (link) props.link = link.getAttribute("href") || link.textContent.trim();

  const ext = firstDirect(node,"extensions");
  if (ext) {
    Array.from(ext.getElementsByTagName("*")).forEach(child => {
      if (child.children.length) return;
      let key = child.getAttribute("name") || localName(child);
      if (!key) return;
      let candidate = key;
      let n = 2;
      while (Object.prototype.hasOwnProperty.call(props,candidate)) candidate = `${key}_${n++}`;
      props[candidate] = child.textContent;
    });
  }
  return props;
}

function gpxPoint(node) {
  const lon = Number(node.getAttribute("lon"));
  const lat = Number(node.getAttribute("lat"));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const eleNode = firstDirect(node,"ele");
  const ele = eleNode ? Number(eleNode.textContent) : NaN;
  return Number.isFinite(ele) ? [lon,lat,ele] : [lon,lat];
}

function parseGPX(text) {
  const doc = parseXML(text);
  const features = [];

  allByLocal(doc,"wpt").forEach((wpt,index) => {
    const coordinate = gpxPoint(wpt);
    if (coordinate) features.push({
      type:"Feature",
      properties:gpxProperties(wpt),
      geometry:{type:"Point",coordinates:coordinate},
      id:`wpt-${index+1}`
    });
  });

  allByLocal(doc,"trk").forEach((trk,index) => {
    const segments = directChildren(trk,"trkseg").map(seg =>
      directChildren(seg,"trkpt").map(gpxPoint).filter(Boolean)
    ).filter(seg => seg.length);
    if (!segments.length) return;
    features.push({
      type:"Feature",
      properties:gpxProperties(trk),
      geometry:segments.length === 1
        ? {type:"LineString",coordinates:segments[0]}
        : {type:"MultiLineString",coordinates:segments},
      id:`trk-${index+1}`
    });
  });

  allByLocal(doc,"rte").forEach((rte,index) => {
    const coords = directChildren(rte,"rtept").map(gpxPoint).filter(Boolean);
    if (!coords.length) return;
    features.push({
      type:"Feature",
      properties:gpxProperties(rte),
      geometry:{type:"LineString",coordinates:coords},
      id:`rte-${index+1}`
    });
  });

  if (!features.length) throw new Error("No waypoints, tracks, or routes were found in the GPX file.");
  return {type:"FeatureCollection",features};
}

function normalizeShpResult(result) {
  const collections = Array.isArray(result) ? result : [result];
  const features = [];
  collections.forEach(collection => {
    if (!collection) return;
    if (collection.type === "FeatureCollection") {
      collection.features.forEach(f => {
        if (collection.fileName && f.properties && !Object.prototype.hasOwnProperty.call(f.properties,"SOURCE")) {
          f.properties.SOURCE = collection.fileName;
        }
        features.push(f);
      });
    } else if (collection.type === "Feature") {
      features.push(collection);
    }
  });
  if (!features.length) throw new Error("No shapefile features were found.");
  return {type:"FeatureCollection",features};
}

function firstCoordinate(geometry) {
  if (!geometry) return null;
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries || []) {
      const c = firstCoordinate(g);
      if (c) return c;
    }
    return null;
  }
  let coords = geometry.coordinates;
  while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
  return Array.isArray(coords) && coords.length >= 2 ? coords : null;
}

function looksGeographic(fc) {
  for (const feature of fc.features) {
    const c = firstCoordinate(feature.geometry);
    if (!c) continue;
    return Math.abs(Number(c[0])) <= 180 && Math.abs(Number(c[1])) <= 90;
  }
  return true;
}

async function zipHasPrj(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    return Object.keys(zip.files).some(name => /\.prj$/i.test(name));
  } catch {
    return false;
  }
}

async function readShapefile(files) {
  let buffer;
  let hasPrj = false;

  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    buffer = await files[0].arrayBuffer();
    hasPrj = await zipHasPrj(buffer);
  } else {
    const names = files.map(f=>f.name.toLowerCase());
    if (!names.some(n=>n.endsWith(".shp"))) throw new Error("Select the SHP file and its companion files together, or upload a shapefile ZIP.");
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, await file.arrayBuffer());
    hasPrj = names.some(n=>n.endsWith(".prj"));
    buffer = await zip.generateAsync({type:"arraybuffer"});
  }

  const result = normalizeShpResult(await shp(buffer));
  if (!hasPrj && !looksGeographic(result)) {
    throw new Error("The shapefile has projected coordinates but no PRJ file. Add the matching PRJ so the tool can locate the features correctly.");
  }
  return result;
}

async function readKMZ(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlName = Object.keys(zip.files).find(name => /\.kml$/i.test(name) && !zip.files[name].dir);
  if (!kmlName) throw new Error("The KMZ does not contain a KML document.");
  return parseKML(await zip.files[kmlName].async("string"));
}

function gatherFields(fc) {
  const fields = [];
  const seen = new Set();
  fc.features.forEach(feature => {
    Object.keys(feature.properties || {}).forEach(key => {
      if (!seen.has(key)) {
        seen.add(key);
        fields.push(key);
      }
    });
  });
  return fields;
}

function geometryCounts(fc) {
  const counts = {};
  const countGeom = geometry => {
    if (!geometry) return;
    if (geometry.type === "GeometryCollection") {
      (geometry.geometries || []).forEach(countGeom);
      return;
    }
    counts[geometry.type] = (counts[geometry.type] || 0) + 1;
  };
  fc.features.forEach(f => countGeom(f.geometry));
  return counts;
}

function renderLoaded(fc) {
  state.geojson = fc;
  state.fields = gatherFields(fc);

  fieldList.innerHTML = "";
  if (state.fields.length) {
    state.fields.forEach(field => {
      const label = document.createElement("label");
      label.className = "check";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.value = field;
      check.dataset.field = "1";
      const span = document.createElement("span");
      span.textContent = field;
      span.title = field;
      label.append(check,span);
      fieldList.appendChild(label);
    });
  } else {
    fieldList.innerHTML = '<div class="note">This file has no attribute fields. Geometry can still be converted.</div>';
  }

  nameField.innerHTML = '<option value="">Automatic name</option>';
  state.fields.forEach(field => {
    const option = document.createElement("option");
    option.value = field;
    option.textContent = field;
    if (field.toLowerCase() === "name") option.selected = true;
    nameField.appendChild(option);
  });

  renderPreview();
  const counts = geometryCounts(fc);
  inputSummary.innerHTML = "";
  const badges = [
    `${fc.features.length.toLocaleString()} feature${fc.features.length===1?"":"s"}`,
    `${state.fields.length} field${state.fields.length===1?"":"s"}`,
    ...Object.entries(counts).map(([type,count]) => `${count} ${type}`)
  ];
  badges.forEach(text => {
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = text;
    inputSummary.appendChild(span);
  });

  fieldsCard.classList.remove("hidden");
  outputCard.classList.remove("hidden");
  setStatus(inputStatus, `${state.sourceType} loaded successfully.`, "success");
  setStatus(outputStatus, "Ready to convert.");
  updateOutputOptions();
}

function renderPreview() {
  const fields = state.fields.slice(0,8);
  const rows = state.geojson.features.slice(0,8);
  const columns = ["Geometry", ...fields];
  let html = "<table><thead><tr>" + columns.map(h=>`<th>${escapeHTML(h)}</th>`).join("") + "</tr></thead><tbody>";
  rows.forEach(feature => {
    const cells = [feature.geometry?.type || "None", ...fields.map(f => feature.properties?.[f] ?? "")];
    html += "<tr>" + cells.map(v=>`<td title="${escapeHTML(v)}">${escapeHTML(v)}</td>`).join("") + "</tr>";
  });
  html += "</tbody></table>";
  if (state.geojson.features.length > 8 || state.fields.length > 8) {
    html += '<div class="note" style="padding:8px 10px">Preview is limited to the first 8 features and first 8 attribute fields.</div>';
  }
  previewWrap.innerHTML = html;
}

async function loadFiles() {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  fieldsCard.classList.add("hidden");
  outputCard.classList.add("hidden");
  inputSummary.innerHTML = "";
  setStatus(inputStatus, "Reading spatial data...");

  try {
    const names = files.map(f=>f.name);
    const extensions = names.map(name => name.toLowerCase().split(".").pop());
    let fc;

    if (files.length === 1 && extensions[0] === "kml") {
      state.sourceType = "KML";
      fc = parseKML(await files[0].text());
    } else if (files.length === 1 && extensions[0] === "kmz") {
      state.sourceType = "KMZ";
      fc = await readKMZ(files[0]);
    } else if (files.length === 1 && extensions[0] === "gpx") {
      state.sourceType = "GPX";
      fc = parseGPX(await files[0].text());
    } else if (
      (files.length === 1 && extensions[0] === "zip") ||
      extensions.some(ext => ["shp","dbf","shx","prj","cpg"].includes(ext))
    ) {
      state.sourceType = "Shapefile";
      fc = await readShapefile(files);
    } else {
      throw new Error("Upload one KML, KMZ, or GPX file, one shapefile ZIP, or the shapefile component files together.");
    }

    state.sourceName = safeFileName(files[0].name.replace(/\.[^.]+$/,"") );
    outputName.value = `${state.sourceName}_converted`;
    renderLoaded(fc);
  } catch (err) {
    setStatus(inputStatus, `Could not load the spatial data: ${err.message}`, "error");
  }
}

function selectedFields() {
  return Array.from(fieldList.querySelectorAll('input[data-field="1"]:checked')).map(c => c.value);
}

function filteredGeoJSON() {
  const keep = selectedFields();
  const chosenNameField = nameField.value;
  return {
    type:"FeatureCollection",
    features:state.geojson.features.map(feature => {
      const properties = {};
      keep.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(feature.properties || {},field)) properties[field] = feature.properties[field];
      });
      const original = feature.properties || {};
      return {
        type:"Feature",
        properties,
        geometry:feature.geometry,
        id:feature.id,
        __agisName: chosenNameField ? original[chosenNameField] : undefined,
        __agisAutoName: original.name
      };
    })
  };
}

function selectedName(feature,index) {
  if (feature.__agisName !== undefined && String(feature.__agisName).trim() !== "") {
    return String(feature.__agisName);
  }
  if (feature.__agisAutoName !== undefined && String(feature.__agisAutoName).trim() !== "") {
    return String(feature.__agisAutoName);
  }
  if (feature.properties?.name !== undefined && String(feature.properties.name).trim() !== "") return String(feature.properties.name);
  return `Feature ${index+1}`;
}

function makeDbfMap(fields) {
  const used = new Set();
  const map = new Map();
  fields.forEach((field,index) => {
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

function mapCoordinates(coords,fn) {
  if (!Array.isArray(coords)) return coords;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") return fn(coords);
  return coords.map(c => mapCoordinates(c,fn));
}

function transformGeometry(geometry,from,to) {
  if (!geometry) return geometry;
  if (geometry.type === "GeometryCollection") {
    return {...geometry,geometries:(geometry.geometries || []).map(g=>transformGeometry(g,from,to))};
  }
  return {
    ...geometry,
    coordinates:mapCoordinates(geometry.coordinates,coord => {
      const xy = proj4(from,to,[coord[0],coord[1]]);
      return coord.length > 2 ? [xy[0],xy[1],...coord.slice(2)] : xy;
    })
  };
}

function explodeForShapefile(fc) {
  const features = [];
  const add = (geometry,properties,id) => {
    if (!geometry) return;
    if (geometry.type === "GeometryCollection") {
      (geometry.geometries || []).forEach((g,i)=>add(g,properties,`${id || "g"}_${i+1}`));
      return;
    }
    if (geometry.type === "MultiPoint") {
      (geometry.coordinates || []).forEach((c,i)=>features.push({type:"Feature",properties:{...properties},geometry:{type:"Point",coordinates:c},id:`${id || "p"}_${i+1}`}));
      return;
    }
    features.push({type:"Feature",properties:{...properties},geometry,id});
  };
  fc.features.forEach(f=>add(f.geometry,f.properties || {},f.id));
  return {type:"FeatureCollection",features};
}

function kmlCoordinates(coords) {
  return coords.map(c => c.map(v => Number(v)).join(",")).join(" ");
}

function geometryToKML(geometry) {
  if (!geometry) return "";
  switch (geometry.type) {
    case "Point":
      return `<Point><coordinates>${geometry.coordinates.map(Number).join(",")}</coordinates></Point>`;
    case "MultiPoint":
      return `<MultiGeometry>${geometry.coordinates.map(c=>geometryToKML({type:"Point",coordinates:c})).join("")}</MultiGeometry>`;
    case "LineString":
      return `<LineString><tessellate>1</tessellate><coordinates>${kmlCoordinates(geometry.coordinates)}</coordinates></LineString>`;
    case "MultiLineString":
      return `<MultiGeometry>${geometry.coordinates.map(c=>geometryToKML({type:"LineString",coordinates:c})).join("")}</MultiGeometry>`;
    case "Polygon": {
      const rings = geometry.coordinates || [];
      if (!rings.length) return "";
      const outer = `<outerBoundaryIs><LinearRing><coordinates>${kmlCoordinates(rings[0])}</coordinates></LinearRing></outerBoundaryIs>`;
      const inner = rings.slice(1).map(r=>`<innerBoundaryIs><LinearRing><coordinates>${kmlCoordinates(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("");
      return `<Polygon><tessellate>1</tessellate>${outer}${inner}</Polygon>`;
    }
    case "MultiPolygon":
      return `<MultiGeometry>${geometry.coordinates.map(c=>geometryToKML({type:"Polygon",coordinates:c})).join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${(geometry.geometries || []).map(geometryToKML).join("")}</MultiGeometry>`;
    default:
      return "";
  }
}

function geoJSONToKML(fc) {
  const placemarks = fc.features.map((feature,index) => {
    const name = selectedName(feature,index);
    const data = Object.entries(feature.properties || {}).map(([key,value]) =>
      `<Data name="${escapeXML(key)}"><value>${escapeXML(value)}</value></Data>`
    ).join("");
    return `<Placemark><name>${escapeXML(name)}</name>${data ? `<ExtendedData>${data}</ExtendedData>` : ""}${geometryToKML(feature.geometry)}</Placemark>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`;
}

function extensionXML(properties) {
  const rows = Object.entries(properties || {});
  if (!rows.length) return "";
  return `<extensions xmlns:agis="https://rjconstantin.github.io/alberta-gis-tools/">${rows.map(([key,value]) =>
    `<agis:field name="${escapeXML(key)}">${escapeXML(value)}</agis:field>`
  ).join("")}</extensions>`;
}

function gpxPointTag(tag,coord,name,properties) {
  const ele = coord.length > 2 && Number.isFinite(Number(coord[2])) ? `<ele>${Number(coord[2])}</ele>` : "";
  return `<${tag} lat="${Number(coord[1])}" lon="${Number(coord[0])}">${ele}<name>${escapeXML(name)}</name>${extensionXML(properties)}</${tag}>`;
}

function lineToTrack(coords,name,properties) {
  const pts = coords.map(c => {
    const ele = c.length > 2 && Number.isFinite(Number(c[2])) ? `<ele>${Number(c[2])}</ele>` : "";
    return `<trkpt lat="${Number(c[1])}" lon="${Number(c[0])}">${ele}</trkpt>`;
  }).join("");
  return `<trk><name>${escapeXML(name)}</name>${extensionXML(properties)}<trkseg>${pts}</trkseg></trk>`;
}

function multiLineToTrack(lines,name,properties) {
  const segments = lines.map(coords => `<trkseg>${coords.map(c => {
    const ele = c.length > 2 && Number.isFinite(Number(c[2])) ? `<ele>${Number(c[2])}</ele>` : "";
    return `<trkpt lat="${Number(c[1])}" lon="${Number(c[0])}">${ele}</trkpt>`;
  }).join("")}</trkseg>`).join("");
  return `<trk><name>${escapeXML(name)}</name>${extensionXML(properties)}${segments}</trk>`;
}

function geometryToGPX(geometry,name,properties) {
  if (!geometry) return "";
  switch (geometry.type) {
    case "Point":
      return gpxPointTag("wpt",geometry.coordinates,name,properties);
    case "MultiPoint":
      return geometry.coordinates.map((c,i)=>gpxPointTag("wpt",c,geometry.coordinates.length>1?`${name} ${i+1}`:name,properties)).join("");
    case "LineString":
      return lineToTrack(geometry.coordinates,name,properties);
    case "MultiLineString":
      return multiLineToTrack(geometry.coordinates,name,properties);
    case "Polygon":
      return multiLineToTrack(geometry.coordinates,name,properties);
    case "MultiPolygon":
      return geometry.coordinates.map((poly,i)=>multiLineToTrack(poly,geometry.coordinates.length>1?`${name} ${i+1}`:name,properties)).join("");
    case "GeometryCollection":
      return (geometry.geometries || []).map((g,i)=>geometryToGPX(g,`${name} ${i+1}`,properties)).join("");
    default:
      return "";
  }
}

function geoJSONToGPX(fc) {
  const body = fc.features.map((feature,index) => geometryToGPX(
    feature.geometry,
    selectedName(feature,index),
    feature.properties || {}
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Alberta GIS Tools" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
}

function hasPolygon(fc) {
  let found = false;
  const check = g => {
    if (!g || found) return;
    if (g.type === "Polygon" || g.type === "MultiPolygon") found = true;
    if (g.type === "GeometryCollection") (g.geometries || []).forEach(check);
  };
  fc.features.forEach(f=>check(f.geometry));
  return found;
}

function validateWGS84(fc) {
  let invalid = false;
  const inspect = coords => {
    if (invalid || !Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      if (Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) invalid = true;
      return;
    }
    coords.forEach(inspect);
  };
  const inspectGeom = g => {
    if (!g) return;
    if (g.type === "GeometryCollection") (g.geometries || []).forEach(inspectGeom);
    else inspect(g.coordinates);
  };
  fc.features.forEach(f=>inspectGeom(f.geometry));
  if (invalid) throw new Error("The geometry is not in valid longitude / latitude coordinates. A shapefile may be missing or using an unsupported PRJ.");
}

async function exportShapefile(fc,name) {
  const target = AGIS_CRS.get(crsSelect.value);
  const keep = selectedFields();
  const dbfMap = makeDbfMap(keep);

  const prepared = {
    type:"FeatureCollection",
    features:fc.features.map(f => {
      const props = {};
      keep.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(f.properties || {},field)) props[dbfMap.get(field)] = f.properties[field];
      });
      return {
        type:"Feature",
        properties:props,
        geometry:transformGeometry(f.geometry,"EPSG:4326",target.id),
        id:f.id
      };
    })
  };
  const exploded = explodeForShapefile(prepared);
  const result = await Promise.resolve(shpwrite.zip(exploded,{
    outputType:"blob",
    prj:target.wkt,
    folder:name,
    filename:name,
    types:{point:`${name}_point`,polyline:`${name}_line`,polygon:`${name}_polygon`}
  }));
  return result instanceof Blob ? result : new Blob([result],{type:"application/zip"});
}

function downloadBlob(blob,filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

async function convert() {
  if (!state.geojson) return;
  const format = outputFormat.value;
  const name = safeFileName(outputName.value);
  outputName.value = name;
  convertButton.disabled = true;
  setStatus(outputStatus,"Converting spatial data...");

  try {
    const fc = filteredGeoJSON();
    let blob,filename,warning="";

    if (format === "shp") {
      validateWGS84(fc);
      blob = await exportShapefile(fc,name);
      filename = `${name}.zip`;
    } else if (format === "kml") {
      validateWGS84(fc);
      blob = new Blob([geoJSONToKML(fc)],{type:"application/vnd.google-earth.kml+xml"});
      filename = `${name}.kml`;
    } else if (format === "kmz") {
      validateWGS84(fc);
      const zip = new JSZip();
      zip.file("doc.kml",geoJSONToKML(fc));
      blob = await zip.generateAsync({type:"blob",compression:"DEFLATE"});
      filename = `${name}.kmz`;
    } else if (format === "gpx") {
      validateWGS84(fc);
      blob = new Blob([geoJSONToGPX(fc)],{type:"application/gpx+xml"});
      filename = `${name}.gpx`;
      if (hasPolygon(fc)) warning = " Polygon geometry was written as GPX boundary tracks because GPX does not have a polygon feature type.";
    } else {
      throw new Error("Choose an output format.");
    }

    downloadBlob(blob,filename);
    setStatus(outputStatus,`${filename} created from ${fc.features.length.toLocaleString()} feature${fc.features.length===1?"":"s"}.${warning}`,warning ? "warning" : "success");
  } catch (err) {
    setStatus(outputStatus,`The conversion could not be completed: ${err.message}`,"error");
  } finally {
    convertButton.disabled = false;
  }
}

function updateOutputOptions() {
  const format = outputFormat.value;
  shpOptions.classList.toggle("hidden",format !== "shp");
  nameFieldWrap.classList.toggle("hidden",!["kml","kmz","gpx"].includes(format));
  if (format === "gpx") nameFieldWrap.firstChild.textContent = "GPX name field";
  else if (format === "kml" || format === "kmz") nameFieldWrap.firstChild.textContent = "KML feature name field";
}

fileInput.addEventListener("change",loadFiles);
outputFormat.addEventListener("change",updateOutputOptions);
el("select-all").addEventListener("click",()=>fieldList.querySelectorAll('input[data-field="1"]').forEach(c=>c.checked=true));
el("select-none").addEventListener("click",()=>fieldList.querySelectorAll('input[data-field="1"]').forEach(c=>c.checked=false));
convertButton.addEventListener("click",convert);

populateCRS();
updateOutputOptions();
