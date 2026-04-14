import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config.yaml");

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. Copy config.example.yaml to config.yaml first.`,
    );
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(raw);

  if (!parsed?.target?.date) {
    throw new Error("config.target.date is required.");
  }

  if (!parsed?.target?.url) {
    throw new Error("config.target.url is required.");
  }

  return parsed;
}

export function resolveArtifactsDir(config) {
  const dir = config?.checkout?.screenshotDir ?? "./artifacts";
  const resolved = path.resolve(process.cwd(), dir);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
