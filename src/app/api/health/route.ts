export const dynamic = "force-static";

export function GET() {
  return Response.json({
    service: "prompt-radar",
    status: "ok",
    version: "0.1.0",
  });
}
