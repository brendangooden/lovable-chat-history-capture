import { describe, expect, test } from "bun:test";
import {
  decodeFields,
  decodeValue,
  docIdFromName,
  type FirestoreValue,
} from "../src/firestore.ts";

describe("decodeValue", () => {
  test("stringValue", () => {
    expect(decodeValue({ stringValue: "hello" })).toBe("hello");
  });

  test("booleanValue", () => {
    expect(decodeValue({ booleanValue: true })).toBe(true);
    expect(decodeValue({ booleanValue: false })).toBe(false);
  });

  test("integerValue stays as string (preserves precision)", () => {
    expect(decodeValue({ integerValue: "42" })).toBe("42");
    expect(decodeValue({ integerValue: "9007199254740993" })).toBe(
      "9007199254740993",
    );
  });

  test("doubleValue", () => {
    expect(decodeValue({ doubleValue: 1.3 })).toBe(1.3);
  });

  test("timestampValue passes through as ISO string", () => {
    const ts = "2026-04-17T02:45:29.014606Z";
    expect(decodeValue({ timestampValue: ts })).toBe(ts);
  });

  test("nullValue", () => {
    expect(decodeValue({ nullValue: null })).toBeNull();
  });

  test("bytesValue returns base64 string unchanged", () => {
    expect(decodeValue({ bytesValue: "aGVsbG8=" })).toBe("aGVsbG8=");
  });

  test("referenceValue returns full path string", () => {
    const ref = "projects/p/databases/(default)/documents/things/x";
    expect(decodeValue({ referenceValue: ref })).toBe(ref);
  });

  test("geoPointValue returns {lat, lng}", () => {
    expect(
      decodeValue({ geoPointValue: { latitude: -33.86, longitude: 151.21 } }),
    ).toEqual({ latitude: -33.86, longitude: 151.21 });
  });

  test("arrayValue recurses", () => {
    const input: FirestoreValue = {
      arrayValue: {
        values: [
          { stringValue: "a" },
          { integerValue: "7" },
          { booleanValue: true },
        ],
      },
    };
    expect(decodeValue(input)).toEqual(["a", "7", true]);
  });

  test("arrayValue with no values", () => {
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
  });

  test("mapValue recurses into fields", () => {
    const input: FirestoreValue = {
      mapValue: {
        fields: {
          name: { stringValue: "Ada" },
          score: { integerValue: "99" },
        },
      },
    };
    expect(decodeValue(input)).toEqual({ name: "Ada", score: "99" });
  });

  test("mapValue with no fields", () => {
    expect(decodeValue({ mapValue: {} })).toEqual({});
  });

  test("deeply nested structures", () => {
    const input: FirestoreValue = {
      mapValue: {
        fields: {
          images: {
            arrayValue: {
              values: [
                {
                  mapValue: {
                    fields: {
                      file_id: { stringValue: "abc" },
                      file_name: { stringValue: "img.png" },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    };
    expect(decodeValue(input)).toEqual({
      images: [{ file_id: "abc", file_name: "img.png" }],
    });
  });
});

describe("decodeFields", () => {
  test("handles undefined input", () => {
    expect(decodeFields(undefined)).toEqual({});
  });

  test("decodes every field", () => {
    expect(
      decodeFields({
        content: { stringValue: "hi" },
        archived: { booleanValue: false },
        count: { integerValue: "3" },
      }),
    ).toEqual({ content: "hi", archived: false, count: "3" });
  });
});

describe("docIdFromName", () => {
  test("returns last path segment", () => {
    expect(
      docIdFromName(
        "projects/proj/databases/(default)/documents/projects/uuid/trajectory/umsg_01ABC",
      ),
    ).toBe("umsg_01ABC");
  });

  test("returns input unchanged when no slashes present", () => {
    expect(docIdFromName("umsg_01ABC")).toBe("umsg_01ABC");
  });

  test("handles trailing slash as empty segment", () => {
    expect(docIdFromName("a/b/c/")).toBe("");
  });
});
