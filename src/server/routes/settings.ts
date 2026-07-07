/**
 * Settings routes — API keys, model switching, settings persistence
 */
import type { RouteHandler } from "./types";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const cors = { "Access-Control-Allow-Origin": "*" };

function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
  });
}

export const handleSettings: RouteHandler = async (req, res, ctx) => {
  const { url, method } = req;
  const { session, modelRegistry, paths: p } = ctx;

  // List available models (only those with configured API key in auth.json)
  if (url === "/api/models") {
    const all = modelRegistry.getAvailable();
    // Read auth.json to see which providers have keys configured in storage (not env vars)
    let configuredProviders: string[] = [];
    try {
      const authRaw = readFileSync(resolve(p.DATA_DIR, "pi", "auth.json"), "utf-8");
      const auth = JSON.parse(authRaw);
      configuredProviders = Object.keys(auth).filter(k => auth[k]?.apiKey);
    } catch { /* no auth.json yet */ }
    const filtered = configuredProviders.length === 0
      ? all.map((m: any) => ({ provider: m.provider, id: m.id }))  // first run: show all
      : all.filter((m: any) => configuredProviders.includes(m.provider)).map((m: any) => ({ provider: m.provider, id: m.id }));
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ models: filtered }));
    return true;
  }

  // Save settings
  if (url === "/api/settings" && method === "POST") {
    try {
      const data = await parseBody(req);
      let settings: any = {};
      if (existsSync(p.SETTINGS_FILE)) {
        settings = JSON.parse(readFileSync(p.SETTINGS_FILE, "utf-8"));
      }
      if (data.defaultProvider) settings.defaultProvider = data.defaultProvider;
      if (data.defaultModel) settings.defaultModel = data.defaultModel;
      writeFileSync(p.SETTINGS_FILE, JSON.stringify(settings, null, 2));
      res.writeHead(200, { ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Get auth keys
  if (url === "/api/auth" && method === "GET") {
    try {
      const authFile = resolve(p.PI_CONFIG_DIR, "auth.json");
      const authData = existsSync(authFile) ? JSON.parse(readFileSync(authFile, "utf-8")) : {};
      const providerKeys = Object.keys(authData).map((provider) => ({
        provider,
        hasKey: !!authData[provider]?.apiKey,
        keyPreview: authData[provider]?.apiKey ? authData[provider].apiKey.slice(0, 8) + "..." : "",
        keyFull: authData[provider]?.apiKey || "",
      }));
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ providers: providerKeys }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Save auth key
  if (url === "/api/auth" && method === "POST") {
    try {
      const { provider, apiKey } = await parseBody(req);
      if (!provider || !apiKey) { res.writeHead(400, { ...cors }); res.end(JSON.stringify({ error: "provider and apiKey required" })); return true; }
      const authFile = resolve(p.PI_CONFIG_DIR, "auth.json");
      let authData: any = {};
      if (existsSync(authFile)) authData = JSON.parse(readFileSync(authFile, "utf-8"));
      authData[provider] = { apiKey };
      writeFileSync(authFile, JSON.stringify(authData, null, 2));
      res.writeHead(200, { ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Hot-switch model
  if (url === "/api/model/switch" && method === "POST") {
    try {
      const { provider, modelId } = await parseBody(req);
      const model = modelRegistry.find(provider, modelId);
      if (!model) {
        res.writeHead(404, { ...cors });
        res.end(JSON.stringify({ error: "未找到模型: " + provider + "/" + modelId }));
        return true;
      }
      // Persist to settings
      let settings: any = {};
      if (existsSync(p.SETTINGS_FILE)) {
        settings = JSON.parse(readFileSync(p.SETTINGS_FILE, "utf-8"));
      }
      settings.defaultProvider = provider;
      settings.defaultModel = modelId;
      writeFileSync(p.SETTINGS_FILE, JSON.stringify(settings, null, 2));
      // Hot switch
      await session.setModel(model);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Layout config save
  if (url === "/api/layout-config" && method === "POST") {
    try {
      const data = await parseBody(req);
      const layoutPath = resolve(p.APP_ROOT, "src", "layout-config.json");
      writeFileSync(layoutPath, JSON.stringify(data, null, 2));
      res.writeHead(200, { ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
};
