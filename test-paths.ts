#!/usr/bin/env bun

import { join } from "path";
import { baseDirectory } from "./src/config/constants.js";
import { listFilesRecursively } from "./src/utils/directory.js";

console.log("Base directory:", baseDirectory);
console.log("Testing listFilesRecursively...");

const files = await listFilesRecursively(baseDirectory, baseDirectory);
console.log("Files found:", files);

for (const file of files.slice(0, 3)) {
  const fullPath = join(baseDirectory, file);
  console.log(`File: ${file}`);
  console.log(`Full path: ${fullPath}`);
}
