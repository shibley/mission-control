#!/usr/bin/env node
// Collects the dashboard snapshot from this Mac and prints it as JSON.
//
// The collection logic lives in src/lib/data.ts and is *not* duplicated here:
// Node strips the types at import time, so the script and the local dashboard
// can never drift apart.
import { snapshot } from "../src/lib/data.ts";

process.stdout.write(JSON.stringify(snapshot(), null, 2) + "\n");
