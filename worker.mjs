
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.BUILD_RUNNER_TOKEN || "";
const CWD = process.env.BUILD_CWD || process.cwd();

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function tail(text, max = 4000) {
  if (!text) return "";
  return text.length > max ? text.slice(text.length - max) : text;
}

function runCommand(command) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    console.log("[build-runner] running:", command);

    const child = spawn(command, {
      shell: true,
      cwd: CWD,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout: tail(stdout),
        stderr: tail(stderr),
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout: tail(stdout),
        stderr: tail(stderr),
        durationMs: Date.now() - startedAt,
        error: code === 0 ? null : `command exited with code ${code}`,
      });
    });
  });
}

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "yawb-build-runner",
        cwd: CWD,
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    if (TOKEN) {
      const auth = req.headers.authorization || "";
      const token = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : "";

      if (token !== TOKEN) {
        sendJson(res, 401, {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: 0,
          error: "invalid bearer token",
        });
        return;
      }
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      sendJson(res, 400, {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "invalid JSON body",
      });
      return;
    }

    const command = payload.command;
    if (!command || typeof command !== "string") {
      sendJson(res, 400, {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "missing command",
      });
      return;
    }

    console.log("[build-runner] job", payload.jobId, payload.stepId, payload.kind);

    const result = await runCommand(command);
    sendJson(res, result.ok ? 200 : 502, result);
  })
  .listen(PORT, () => {
    console.log(`yawb build runner listening on port ${PORT}`);
    console.log(`cwd: ${CWD}`);
  });
