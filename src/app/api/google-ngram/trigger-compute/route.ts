import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Get Compute Engine configuration
    const projectId = await getSecret('firebase-project-id')
    const zone = await getSecret('firebase-zone')
    const machineType = 'e2-highmem-2'
    const serviceAccount = await getSecret('gcp-service-account')
    const firebaseBucket = await getSecret('firebase-storage-bucket')
    const firestoreDb = 'lexileap'
    
    if (!projectId) {
      return NextResponse.json({ error: 'GCP project ID not configured' }, { status: 503 })
    }

    // Authenticate with Google Cloud
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
    const client = await auth.getClient()
    const accessToken = await client.getAccessToken()

    // Create Compute Engine instance
    const instanceName = `ngram-processor-${Date.now()}`
    const scriptsBucket = `${projectId}-compute-engine-startup`
    const scriptsPrefix = 'compute-engine-startup'

    const instanceConfig = {
      name: instanceName,
      machineType: `zones/${zone}/machineTypes/${machineType}`,
      disks: [{
        boot: true,
        autoDelete: true,
        initializeParams: {
          sourceImage: 'projects/debian-cloud/global/images/family/debian-11',
          diskSizeGb: '50'
        }
      }],
      networkInterfaces: [{
        accessConfigs: [{
          type: 'ONE_TO_ONE_NAT',
          name: 'External NAT'
        }],
        network: 'global/networks/default'
      }],
      serviceAccounts: [{
        email: serviceAccount,
        // Use a single broad scope; IAM controls actual permissions
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform'
        ]
      }],
      metadata: {
        items: [{
          key: 'startup-script-url',
          value: `gs://${scriptsBucket}/${scriptsPrefix}/compute_engine_startup.sh`
        }, {
          key: 'firebase-storage-bucket',
          value: firebaseBucket
        }, {
          key: 'startup-scripts-bucket',
          value: scriptsBucket
        }, {
          key: 'startup-scripts-prefix',
          value: scriptsPrefix
        }, {
          key: 'firestore-database',
          value: firestoreDb
        }]
      },
      tags: {
        items: ['ngram-processor']
      }
    }

    // Create the instance
    const computeUrl = `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances`
    const response = await fetch(computeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(instanceConfig)
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to create Compute Engine instance:', new Error(`Status ${response.status}: ${errorText}`))
      return NextResponse.json({ error: 'Failed to create Compute Engine instance', details: errorText }, { status: 500 })
    }

    await response.json() // Consume response body
    logger.info(`Created Compute Engine instance: ${instanceName}`)

    return NextResponse.json({ 
      success: true, 
      instanceName,
      zone,
      message: 'Compute Engine instance created and processing started' 
    })

  } catch (error) {
    logger.error('Compute Engine trigger error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to trigger Compute Engine processing' }, { status: 500 })
  }
}
