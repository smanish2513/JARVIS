import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteOwnerExpense, getDatabase, insertOwnerExpense, listOwnerExpenses } from "@/lib/database";
import { isOwnerRequest, ownerId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const newExpenseSchema = z.object({
  merchant: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  amount: z.number().finite().positive().max(9_999_999_999),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function unavailable() {
  return NextResponse.json({ error: "Cloud expense sync is not configured." }, { status: 503 });
}

function unauthorized() {
  return NextResponse.json({ error: "Sign in to your private JARVIS workspace." }, { status: 401 });
}

export async function GET(request: Request) {
  if (!isOwnerRequest(request)) return unauthorized();
  const sql = getDatabase();
  if (!sql) return unavailable();

  try {
    return NextResponse.json({ source: "database", expenses: await listOwnerExpenses(sql, ownerId()) });
  } catch {
    return NextResponse.json({ error: "Could not load expenses from the database." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isOwnerRequest(request)) return unauthorized();
  const sql = getDatabase();
  if (!sql) return unavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON expense." }, { status: 400 });
  }

  const parsed = newExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the merchant, category, amount, and date." }, { status: 400 });
  }

  const date = new Date(`${parsed.data.date}T12:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== parsed.data.date) {
    return NextResponse.json({ error: "Enter a valid expense date." }, { status: 400 });
  }

  try {
    const expense = await insertOwnerExpense(sql, ownerId(), { ...parsed.data, id: crypto.randomUUID() });
    return NextResponse.json({ source: "database", expense }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not save this expense." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isOwnerRequest(request)) return unauthorized();
  const sql = getDatabase();
  if (!sql) return unavailable();

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "A valid expense ID is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteOwnerExpense(sql, ownerId(), id);
    return deleted
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "Expense not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not remove this expense." }, { status: 503 });
  }
}
