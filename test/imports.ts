/// Test file for import string navigation

import { Parser } from "./example.js";

async function loadLsp() {
  await import("./example.js");
}

const x = require("./example.js");
