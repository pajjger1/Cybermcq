"use client";
import { Amplify } from "aws-amplify";
import amplifyOutputs from "../../amplify_outputs.json";

let configured = false;

export function ensureAmplifyConfigured() {
  if (configured) return;
  
  // Configure Amplify using the generated outputs
  Amplify.configure(amplifyOutputs);
  configured = true;
}


