
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const logData = await request.json()
  
  // This will appear in Cloud Run logs
  if (logData.severity === 'ERROR') {
    console.error(JSON.stringify(logData))
  } else if (logData.severity === 'DEBUG') {
    console.debug(JSON.stringify(logData))
  } else {
    console.log(JSON.stringify(logData))
  }

  return NextResponse.json({ success: true })
} 
