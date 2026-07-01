import { orqLiteBaseURL } from "@/lib/orq-lite"

export const dynamic = "force-dynamic"

export async function GET() {
  const baseURL = orqLiteBaseURL()
  if (!baseURL) {
    return new Response(
      'event: error\ndata: {"error":"ORQ_LITE_API_URL is not configured"}\n\n',
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        },
      },
    )
  }

  const upstream = await fetch(`${baseURL}/api/events`, {
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    },
  })
}
