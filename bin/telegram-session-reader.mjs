#!/usr/bin/env node
import { readValidatedTelegramSessionFiles } from "./telegram-session-validator.mjs";

/* argv[3] is the optional account slot; without it this reads the default
   session exactly as it always has. */
const result = readValidatedTelegramSessionFiles(process.argv[2] ?? "", process.argv[3]);
if (result.status === "valid") process.stdout.write(result.connectorToken);
else process.exitCode = 1;
