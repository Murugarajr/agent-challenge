/**
 * Next.js API route: /api/agent/[...path]
 * Proxies all requests to the ElizaOS agent to avoid CORS issues.
 * Unlike next.config rewrites, this properly forwards the request body and headers.
 */
import { type NextRequest, NextResponse } from "next/server";

const AGENT_ORIGIN = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3000";

async function proxy(req: NextRequest, params: { path: string[] }) {
    const subPath = params.path.join("/");
    const search = req.nextUrl.search ?? "";
    const target = `${AGENT_ORIGIN}/${subPath}${search}`;

    const headers = new Headers();
    // Forward relevant headers
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const accept = req.headers.get("accept");
    if (accept) headers.set("accept", accept);

    let body: BodyInit | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
        body = await req.arrayBuffer();
    }

    const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: body ?? undefined,
        // @ts-expect-error -- Node 18 fetch
        duplex: "half",
    });

    const responseBody = await upstream.arrayBuffer();
    const responseHeaders = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) responseHeaders.set("content-type", ct);

    return new NextResponse(responseBody, {
        status: upstream.status,
        headers: responseHeaders,
    });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}
export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
