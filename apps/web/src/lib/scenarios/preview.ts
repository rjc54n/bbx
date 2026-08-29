import { parseScenarioDefinition, type ScenarioDefinition } from "./definition";

// A scenario "Run" (as opposed to "Save and run") carries the editor's current
// {filters, sort} in the URL as `?preview=<encoded JSON>`, so the server page
// can evaluate unsaved edits without writing to saved_scenarios. Definitions are
// a handful of filters, so a plain URL-encoded JSON string stays short and
// stays debuggable.

export const PREVIEW_PARAM = "preview";

// The param's logical value is the raw JSON string. Percent-encoding for
// transport is always left to URLSearchParams (both when building hrefs and when
// Next parses searchParams), so this never calls encode/decodeURIComponent
// itself -- doing so would double-decode a filter value that legitimately
// contains a "%".
export function encodeScenarioPreview(definition: ScenarioDefinition): string {
  return JSON.stringify(definition);
}

export function scenarioPreviewHref(basePath: string, definition: ScenarioDefinition): string {
  return `${basePath}?${new URLSearchParams({ [PREVIEW_PARAM]: encodeScenarioPreview(definition) }).toString()}`;
}

// Returns a registry-valid definition, or null when the param is absent,
// malformed, or has no usable filter (in which case the page falls back to the
// saved definition / shows nothing to run).
export function decodeScenarioPreview(raw: string | string[] | undefined): ScenarioDefinition | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const definition = parseScenarioDefinition(parsed);
  return definition.filters.length > 0 ? definition : null;
}
