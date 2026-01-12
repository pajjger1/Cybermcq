"use client";
import { Amplify } from "aws-amplify";
import amplifyOutputs from "../../amplify_outputs.json";

let configured = false;

export function ensureAmplifyConfigured() {
  if (configured) return;
  
  try {
    console.log('[AmplifyClient] Configuring Amplify with outputs from:', amplifyOutputs.data?.aws_region);
    console.log('[AmplifyClient] Identity Pool:', amplifyOutputs.auth?.identity_pool_id ? 'Configured' : 'Missing');
    console.log('[AmplifyClient] Unauthenticated access:', amplifyOutputs.auth?.unauthenticated_identities_enabled);
    
    // Configure Amplify using the generated outputs
    Amplify.configure(amplifyOutputs, { ssr: true });
    configured = true;
    
    console.log('[AmplifyClient] Amplify configured successfully');
  } catch (error) {
    console.error('[AmplifyClient] Failed to configure Amplify:', error);
    throw error;
  }
}


