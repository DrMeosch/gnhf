import { describe, expect, it } from "vitest";
import {
  extractLastJsonObject,
  parseAgentJson,
  stripJsonFences,
  tryExtractBalancedObject,
} from "./json-extract.js";

describe("stripJsonFences", () => {
  it("returns trimmed text when there are no fences", () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("strips a ```json fence", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips a bare ``` fence", () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe("tryExtractBalancedObject", () => {
  it("returns the balanced object starting at the index", () => {
    const text = 'noise {"a":1} more';
    expect(tryExtractBalancedObject(text, 6)).toBe('{"a":1}');
  });

  it("respects nested braces", () => {
    const text = '{"a":{"b":2}}';
    expect(tryExtractBalancedObject(text, 0)).toBe('{"a":{"b":2}}');
  });

  it("ignores braces inside strings", () => {
    const text = '{"a":"{not real}"}';
    expect(tryExtractBalancedObject(text, 0)).toBe('{"a":"{not real}"}');
  });

  it("returns null when start is not an opening brace", () => {
    expect(tryExtractBalancedObject('"a":1', 0)).toBeNull();
  });

  it("returns null when the object is unterminated", () => {
    expect(tryExtractBalancedObject('{"a":1', 0)).toBeNull();
  });
});

describe("extractLastJsonObject", () => {
  it("returns the rightmost balanced JSON object", () => {
    const text = 'first {"a":1} then {"b":2}';
    expect(extractLastJsonObject(text)).toBe('{"b":2}');
  });

  it("returns null when there is no balanced object", () => {
    expect(extractLastJsonObject("plain prose with no braces")).toBeNull();
  });

  it("falls back when the rightmost candidate is unterminated", () => {
    const text = 'good {"a":1} bad {"b":';
    expect(extractLastJsonObject(text)).toBe('{"a":1}');
  });

  it("continues scanning when the rightmost parsed object is rejected", () => {
    const text =
      'final {"success":true,"summary":"mentions {}","key_changes_made":[],"key_learnings":[]} trailing';

    expect(
      extractLastJsonObject(text, (value) =>
        Boolean(
          value &&
          typeof value === "object" &&
          "success" in value &&
          "summary" in value,
        ),
      ),
    ).toBe(
      '{"success":true,"summary":"mentions {}","key_changes_made":[],"key_learnings":[]}',
    );
  });

  // Regression: String#lastIndexOf clamps a negative fromIndex to 0, so
  // scanning backwards from a `{` at index 0 used to find index 0 again and
  // spin forever, hanging the whole process.
  it("returns null when the only candidate is an unterminated object at index 0", () => {
    expect(extractLastJsonObject('{"a":["x"],"}')).toBeNull();
  });

  it("returns null when an object at index 0 is the last candidate and is rejected", () => {
    expect(extractLastJsonObject('{"a":1} trailing {', () => false)).toBeNull();
    expect(extractLastJsonObject('{"a":1} trailing', () => false)).toBeNull();
  });

  it("still scans earlier candidates after index 0 is exhausted", () => {
    expect(extractLastJsonObject('{"a":1} then {"b":')).toBe('{"a":1}');
  });
});

describe("parseAgentJson", () => {
  it("parses pure JSON", () => {
    expect(parseAgentJson('{"success":true}')).toEqual({ success: true });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(parseAgentJson('```json\n{"success":true}\n```')).toEqual({
      success: true,
    });
  });

  it("recovers JSON when the agent prepends prose (the rovodev #144 case)", () => {
    const text =
      'BUILD SUCCESS confirms the Java changes are valid.\n\n{"success": true, "summary": "x", "key_changes_made": [], "key_learnings": []}';
    expect(parseAgentJson(text)).toEqual({
      success: true,
      summary: "x",
      key_changes_made: [],
      key_learnings: [],
    });
  });

  it("recovers JSON when the agent appends trailing prose", () => {
    const text = '{"success":true}\n\nDone!';
    expect(parseAgentJson(text)).toEqual({ success: true });
  });

  it("prefers the last JSON object when multiple are present", () => {
    const text = 'log: {"step":1}\nfinal: {"step":2}';
    expect(parseAgentJson(text)).toEqual({ step: 2 });
  });

  it("does not extract nested objects after a parsed top-level object is rejected", () => {
    const text =
      '{"success":true,"summary":{"success":true,"summary":"nested","key_changes_made":[],"key_learnings":[]},"key_changes_made":[],"key_learnings":[]}';

    expect(
      parseAgentJson(text, (value) =>
        Boolean(
          value &&
          typeof value === "object" &&
          "summary" in value &&
          typeof value.summary === "string",
        ),
      ),
    ).toBeNull();
  });

  it("returns null for unparseable text", () => {
    expect(parseAgentJson("just prose, no json here")).toBeNull();
  });

  it("returns null for a truncated object that starts at index 0", () => {
    expect(parseAgentJson('{"a":["x"],"}')).toBeNull();
    expect(
      parseAgentJson(
        '{"success":true,"summary":"s","key_changes_made":["c"],"key_learnings":["l"],"}',
      ),
    ).toBeNull();
  });

  it("returns null when a nested object parses but the outer object is truncated", () => {
    expect(parseAgentJson('{"a":{"b":1},"}', () => false)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseAgentJson("")).toBeNull();
    expect(parseAgentJson("   ")).toBeNull();
  });
});
