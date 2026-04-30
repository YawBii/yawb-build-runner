import http from "node:http";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 8787;
const TOKEN = process.env.BUILD_RUNNER_TOKEN || "";
const BUILD_CWD = process.env.BUILD_CWD || process.cwd();

function tail(str, max = 8000) {
  return str.length <= max ? str : str.slice(str.length - max);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function runCommand(command) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const child = spawn(command, {
      shell: true,
      cwd: BUILD_CWD,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
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
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "method not allowed" });
    }

    if (TOKEN) {
      const auth = req.headers.authorization || "";
      const given = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : "";

      if (given !== TOKEN) {
        return json(res, 401, {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: 0,
          error: "invalid bearer token",
        });
      }
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(res, 400, {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "invalid JSON body",
      });
    }

    const { command, kind, jobId, stepId, projectId } = payload;

    if (!command || !kind || !jobId || !stepId || !projectId) {
      return json(res, 400, {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "missing command/kind/jobId/stepId/projectId",
      });
    }

    console.log(`[build-runner] ${kind} ${projectId} ${jobId} ${stepId}`);
    console.log(`[build-runner] running: ${command}`);

    const result = await runCommand(command);

    return json(res, result.ok ? 200 : 502, result);
  })
  .listen(PORT, () => {
    console.log(`yawb build runner listening on port ${PORT}`);
    console.log(`cwd: ${BUILD_CWD}`);
  });
