// specialized.js — format-aware inspectors: GeoJSON, JSON-LD, HAR, OpenAPI.
// All produce a structured report (no external map tiles — privacy-first).
import { isPlainObject } from "../core/util.js";

export function geojsonInfo(value) {
  if (!isPlainObject(value) || !value.type) throw new Error("Not a GeoJSON object (missing 'type').");
  const features = value.type === "FeatureCollection" ? (value.features || [])
    : value.type === "Feature" ? [value] : [];
  const geomTypes = {};
  let bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const scan = (coords) => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
    } else coords.forEach(scan);
  };
  for (const f of features) {
    const g = f.geometry;
    if (g) { geomTypes[g.type] = (geomTypes[g.type] || 0) + 1; if (g.coordinates) scan(g.coordinates); }
  }
  const props = new Set();
  for (const f of features) if (f.properties) Object.keys(f.properties).forEach((k) => props.add(k));
  return {
    rootType: value.type,
    featureCount: features.length,
    geometryTypes: geomTypes,
    bbox: bbox.every(Number.isFinite) ? bbox : null,
    properties: [...props],
  };
}

export function jsonldInfo(value) {
  const nodes = Array.isArray(value) ? value : (value["@graph"] || [value]);
  const issues = [];
  const types = {};
  let hasContext = !!(value["@context"]);
  for (const n of nodes) {
    if (!isPlainObject(n)) continue;
    const t = n["@type"] || n.type;
    if (t) (Array.isArray(t) ? t : [t]).forEach((x) => types[x] = (types[x] || 0) + 1);
    else issues.push("A node is missing @type.");
  }
  if (!hasContext) issues.push("Missing @context — required for JSON-LD.");
  return { hasContext, nodeCount: nodes.length, types, issues };
}

export function harInfo(value) {
  const entries = value?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("Not a HAR file (missing log.entries).");
  const byStatus = {}, byType = {}, byMethod = {};
  let totalBytes = 0, totalTime = 0;
  const slowest = [];
  for (const e of entries) {
    const st = e.response?.status ?? 0;
    byStatus[st] = (byStatus[st] || 0) + 1;
    byMethod[e.request?.method || "?"] = (byMethod[e.request?.method || "?"] || 0) + 1;
    const mime = (e.response?.content?.mimeType || "other").split(";")[0];
    byType[mime] = (byType[mime] || 0) + 1;
    totalBytes += e.response?.content?.size || 0;
    totalTime += e.time || 0;
    slowest.push({ url: e.request?.url || "", time: Math.round(e.time || 0), status: st });
  }
  slowest.sort((a, b) => b.time - a.time);
  return {
    requests: entries.length,
    byMethod, byStatus, byType,
    totalBytes, totalTime: Math.round(totalTime),
    slowest: slowest.slice(0, 8),
  };
}

export function openapiInfo(value) {
  const version = value.openapi || value.swagger;
  if (!version) throw new Error("Not an OpenAPI/Swagger document.");
  const paths = value.paths || {};
  const ops = [];
  for (const p of Object.keys(paths)) {
    for (const m of Object.keys(paths[p])) {
      if (["get", "post", "put", "delete", "patch", "options", "head"].includes(m)) {
        ops.push({ method: m.toUpperCase(), path: p, summary: paths[p][m].summary || "" });
      }
    }
  }
  const schemas = value.components?.schemas || value.definitions || {};
  return {
    version,
    title: value.info?.title || "(untitled)",
    apiVersion: value.info?.version || "",
    pathCount: Object.keys(paths).length,
    operationCount: ops.length,
    operations: ops.slice(0, 50),
    schemaCount: Object.keys(schemas).length,
    schemas: Object.keys(schemas).slice(0, 50),
  };
}
