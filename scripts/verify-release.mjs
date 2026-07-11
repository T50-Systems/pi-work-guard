#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const failures = [];
const tagFlagIndex = process.argv.indexOf("--tag");
const tagArgument = process.argv.find((argument) => argument.startsWith("--tag="))?.slice("--tag=".length)
  ?? (tagFlagIndex >= 0 ? process.argv[tagFlagIndex + 1] : undefined);

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  failures.push(`package version is not valid SemVer: ${packageJson.version}`);
}
if (lock.version !== packageJson.version || lock.packages?.[""]?.version !== packageJson.version) {
  failures.push("package.json and package-lock.json versions differ");
}
if (!/^## \[Unreleased\]$/m.test(changelog)) failures.push("CHANGELOG.md needs an [Unreleased] section");
if (!new RegExp(`^## \\[${packageJson.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
  failures.push(`CHANGELOG.md needs a dated [${packageJson.version}] release heading`);
}
if (tagArgument !== undefined && tagArgument !== `v${packageJson.version}`) {
  failures.push(`tag ${tagArgument || "(empty)"} must exactly match package version v${packageJson.version}`);
}

for (const required of ["docs", "examples", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE"]) {
  if (!packageJson.files.includes(required)) failures.push(`package files omit ${required}`);
}

if (failures.length > 0) {
  console.error("release verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`release verification ok: v${packageJson.version}, tag${tagArgument ? ` ${tagArgument},` : " not requested,"} changelog and package contents aligned`);
