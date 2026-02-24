import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function GET() {
  try {
    let files: string[];
    try {
      files = await readdir(UPLOADS_DIR);
    } catch {
      // Directory doesn't exist yet
      return NextResponse.json({ success: true, images: [] });
    }

    const images = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;

      const filePath = path.join(UPLOADS_DIR, file);
      const info = await stat(filePath);

      images.push({
        filename: file,
        url: `/uploads/${file}`,
        size: info.size,
        createdAt: info.birthtime.toISOString(),
      });
    }

    // Newest first
    images.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ success: true, images, total: images.length });
  } catch (error: unknown) {
    console.error("[gallery GET]", error);
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
