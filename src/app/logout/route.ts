import { NextResponse } from "next/server";
import { destroySession } from "@/server/session";

export async function POST(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
