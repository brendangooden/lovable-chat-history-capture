import { describe, expect, test } from "bun:test";
import { sanitizeFileName } from "../src/storage.ts";

describe("sanitizeFileName", () => {
  test("replaces path separators and Windows-forbidden characters", () => {
    expect(sanitizeFileName("a/b\\c:d*e?f\"g<h>i|j")).toBe(
      "a_b_c_d_e_f_g_h_i_j",
    );
  });

  test("strips NUL and other control characters", () => {
    expect(sanitizeFileName("safe\x00name\x07.png")).toBe("safe_name_.png");
  });

  test("neutralises directory traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeFileName("..")).toBe("_");
    expect(sanitizeFileName("....")).toBe("_");
  });

  test("strips leading dots (no hidden files)", () => {
    expect(sanitizeFileName(".hidden.png")).toBe("hidden.png");
    expect(sanitizeFileName("...leading.png")).toBe("leading.png");
  });

  test("trims trailing dots and spaces (Windows quirk)", () => {
    expect(sanitizeFileName("name.png ")).toBe("name.png");
    expect(sanitizeFileName("name.png.")).toBe("name.png");
  });

  test("prefixes Windows reserved device names", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("nul.txt")).toBe("_nul.txt");
    expect(sanitizeFileName("COM1.log")).toBe("_COM1.log");
  });

  test("returns '_' for empty-after-sanitisation inputs", () => {
    expect(sanitizeFileName("")).toBe("_");
    expect(sanitizeFileName("   ")).toBe("_");
    expect(sanitizeFileName("\x00\x00\x00")).toBe("_");
  });

  test("preserves ordinary filenames", () => {
    expect(sanitizeFileName("image.png")).toBe("image.png");
    expect(sanitizeFileName("Brand Guidelines 2025.pdf")).toBe(
      "Brand Guidelines 2025.pdf",
    );
    expect(sanitizeFileName("name-with_underscores.txt")).toBe(
      "name-with_underscores.txt",
    );
  });
});
