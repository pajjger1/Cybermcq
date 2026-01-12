import { NextResponse } from "next/server";
import amplifyOutputs from "../../../../amplify_outputs.json";

export async function GET() {
  return NextResponse.json({
    auth: {
      region: amplifyOutputs.auth?.aws_region,
      identityPoolId: amplifyOutputs.auth?.identity_pool_id ? "✅ Configured" : "❌ Missing",
      userPoolId: amplifyOutputs.auth?.user_pool_id ? "✅ Configured" : "❌ Missing",
      unauthenticatedEnabled: amplifyOutputs.auth?.unauthenticated_identities_enabled,
    },
    data: {
      region: amplifyOutputs.data?.aws_region,
      endpoint: amplifyOutputs.data?.url,
      defaultAuthType: amplifyOutputs.data?.default_authorization_type,
      authorizationTypes: amplifyOutputs.data?.authorization_types,
    },
    timestamp: new Date().toISOString(),
  });
}
