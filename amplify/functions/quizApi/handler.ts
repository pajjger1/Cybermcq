import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Define allowed origins
  const allowedOrigins = [
    'http://localhost:3000',
    'https://cybermcq.com',
    'https://www.cybermcq.com'
  ];

  // Get the origin from the request
  const origin = event.headers?.origin || event.headers?.Origin;
  
  // Check if origin is allowed (including Amplify hosting domains)
  const isAllowedOrigin = origin && (
    allowedOrigins.includes(origin) || 
    origin.endsWith('.amplifyapp.com')
  );
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'http://localhost:3000',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  // For now, return a simple response
  // TODO: Implement quiz API logic or integrate with Python function
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Quiz API is working',
      method: event.httpMethod,
      path: event.path,
      timestamp: new Date().toISOString(),
    }),
  };
};
