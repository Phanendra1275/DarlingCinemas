import { NextRequest } from "next/server";

export async function GET(req: NextRequest, { params }: { params: { fileId: string } }) {
  const fileId = params.fileId;
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  let url = apiKey 
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    const range = req.headers.get("range");
    const fetchOptions: RequestInit = {
      method: "GET", // Always use GET to Google Drive so we receive the HTML body for virus scan
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...(range ? { "Range": range } : {})
      },
      redirect: "manual"
    };

    let response = await fetch(url, fetchOptions);
    let cookieStore: string[] = [];
    
    const extractCookies = (res: Response) => {
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (setCookies.length > 0) {
        setCookies.forEach(c => cookieStore.push(c.split(';')[0]));
      } else {
        const singleCookie = res.headers.get("set-cookie");
        if (singleCookie) cookieStore.push(singleCookie.split(';')[0]);
      }
    };
    
    extractCookies(response);

    // Follow redirects manually up to 5 times
    let redirectCount = 0;
    while (response.status >= 300 && response.status < 400 && redirectCount < 5) {
      const location = response.headers.get("location");
      if (!location) break;
      const nextHeaders: Record<string, string> = { ...fetchOptions.headers as Record<string, string> };
      if (cookieStore.length > 0) {
        nextHeaders["Cookie"] = cookieStore.join("; ");
      }
      response = await fetch(location, {
        method: "GET",
        headers: nextHeaders,
        redirect: "manual"
      });
      extractCookies(response);
      redirectCount++;
    }

    const contentType = response.headers.get("content-type") || "";
    
    // Check if Google Drive returned a virus scan warning (HTML)
    if (contentType.includes("text/html") && response.ok) {
      const text = await response.text();
      
      const uuidMatch = text.match(/name="uuid" value="([^"]+)"/);
      
      if (uuidMatch) {
        const uuid = uuidMatch[1];
        const confirmToken = 't';
        
        // Reconstruct the URL with the confirm token and uuid
        url = response.url + `&confirm=${confirmToken}&uuid=${uuid}`;
        
        const headers: Record<string, string> = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ...(range ? { "Range": range } : {})
        };
        
        if (cookieStore.length > 0) {
           headers["Cookie"] = cookieStore.join('; ');
        }

        response = await fetch(url, {
          method: "GET",
          headers,
          redirect: "manual"
        });
        extractCookies(response);
        
        let redirectCount2 = 0;
        while (response.status >= 300 && response.status < 400 && redirectCount2 < 5) {
          const location = response.headers.get("location");
          if (!location) break;
          headers["Cookie"] = cookieStore.join("; ");
          response = await fetch(location, {
            method: "GET",
            headers,
            redirect: "manual"
          });
          extractCookies(response);
          redirectCount2++;
        }
      } else {
        // HTML but no confirm token -> Private file, deleted, or error
        return new Response("File is private or not found", { status: 404 });
      }
    }

    if (!response.ok) {
      return new Response("Failed to fetch from Google Drive", { status: response.status });
    }

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    
    // Pass through relevant headers
    const passThrough = ["content-type", "content-length", "content-range", "accept-ranges"];
    passThrough.forEach(h => {
      const val = response.headers.get(h);
      if (val) headers.set(h, val);
    });

    return new Response(req.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers
    });
  } catch (error) {
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function HEAD(req: NextRequest, ctx: { params: { fileId: string } }) {
  return GET(req, ctx);
}
