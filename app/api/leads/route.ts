import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

/** GET /api/leads — list all leads */
export async function GET() {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads ORDER BY created_at DESC"
    );

    return NextResponse.json({ success: true, leads: rows });
  } catch (error: unknown) {
    console.error("[leads GET]", error);
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/** POST /api/leads — create a new lead */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, company, image_url } = body as {
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
      image_url?: string;
    };

    if (!name && !email && !phone) {
      return NextResponse.json(
        {
          success: false,
          error:
            "At least one of name, email, or phone is required.",
        },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO leads (name, email, phone, company, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [name ?? null, email ?? null, phone ?? null, company ?? null, image_url ?? null]
    );

    return NextResponse.json(
      {
        success: true,
        lead: {
          id: result.insertId,
          name,
          email,
          phone,
          company,
          image_url,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("[leads POST]", error);
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
