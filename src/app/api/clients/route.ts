import { NextResponse } from "next/server";
import { listClients } from "@/domain/client/queries";

export async function GET() {
  const clients = await listClients();
  return NextResponse.json(clients);
}
