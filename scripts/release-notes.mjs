#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
  console.error("usage: node scripts/release-notes.mjs vX.Y.Z");
  process.exit(2);
}

const version = tag.slice(1);
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const escaped = version.replaceAll(".", "\\.");
const heading = changelog.match(new RegExp(`^## \\[${escaped}\\] - (\\d{4}-\\d{2}-\\d{2})$`, "m"));
if (!heading || heading.index === undefined) {
  console.error(`no dated changelog section found for ${tag}`);
  process.exit(1);
}
const bodyStart = heading.index + heading[0].length;
const nextHeading = changelog.slice(bodyStart).search(/^## \[/m);
const bodyEnd = nextHeading < 0 ? changelog.length : bodyStart + nextHeading;
const body = changelog.slice(bodyStart, bodyEnd).trim();
process.stdout.write(`# ${tag} — ${heading[1]}\n\n${body}\n`);
