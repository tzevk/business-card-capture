import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

/** Allowed MIME types and their file extensions */
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    // ── Validate presence ──
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No image file provided. Send as 'image' field." },
        { status: 400 }
      );
    }

    // ── Validate MIME type ──
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file type: ${file.type}. Allowed: ${Object.keys(ALLOWED_TYPES).join(", ")}`,
        },
        { status: 400 }
      );
    }

    // ── Validate size ──
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        },
        { status: 400 }
      );
    }

    // ── Ensure upload directory exists ──
    await mkdir(UPLOADS_DIR, { recursive: true });

    // ── Write file ──
    const filename = `${uuidv4()}${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());

    await writeFile(filepath, buffer);

    return NextResponse.json(
      {
        success: true,
        filename,
        url: `/uploads/${filename}`,
        size: file.size,
        type: file.type,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("[upload] Error:", error);

    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
