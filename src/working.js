const express = require("express");
const { GoogleAuth, Impersonated } = require("google-auth-library");
const monitoring = require("@google-cloud/monitoring");
const { v1 } = require('@google-cloud/asset');
require("dotenv").config();

const app = express();
const port = 5000;

const MAIN_KEYFILE = "../keyfile.json"; // Path to your service account key file
const TARGET_SA = "test-426@encoded-breaker-455510-p1.iam.gserviceaccount.com";

app.use(express.json());

// Create the impersonated client
async function getImpersonatedAuthClient() {
    try {
        // First, create the source auth client this for owner
        const auth = new GoogleAuth({
            keyFile: MAIN_KEYFILE,
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });

        const sourceClient = await auth.getClient();
        console.log("Base client authenticated successfully.");

        // Then create the impersonated client user account
        const targetClient = new Impersonated({
            sourceClient: sourceClient,
            targetPrincipal: TARGET_SA,
            lifetime: 3600,
            delegates: [],
            targetScopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });

        console.log("Impersonated client created successfully.");
        return targetClient;
    } catch (error) {
        console.error("Authentication error:", error);
        throw error;
    }
}

// Function to list projects using native fetch
async function listProjects(authClient) {
    try {
        // Get the access token
        const tokenResponse = await authClient.getAccessToken();
        const token = tokenResponse.token || tokenResponse;

        console.log("Access token obtained:", token.substring(0, 10) + "...");

        // Make the API request
        const response = await fetch(
            "https://cloudresourcemanager.googleapis.com/v1/projects",
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        const projects = data.projects || [];

        if (!projects.length) {
            console.log(
                "No accessible projects found for the impersonated service account."
            );
        } else {
            console.log(`Found ${projects.length} projects`);
        }

        return projects.map((p) => p.projectId);
    } catch (err) {
        console.error("Error listing projects:", err.message);
        return [];
    }
}

// Function to create a monitoring client using the impersonated credentials
async function createMonitoringClient(authClient) {
    // Get the access token
    const tokenResponse = await authClient.getAccessToken();
    const token = tokenResponse.token || tokenResponse;

    // Create a monitoring client with the token
    const client = new monitoring.MetricServiceClient({
        authClient: authClient,
    });

    return client;
}

// Function to create a Cloud Asset client using the impersonated credentials
async function createAssetClient(authClient) {
    // Create a Cloud Asset client with the auth client
    const client = new v1.AssetServiceClient({
        authClient: authClient,
    });

    return client;
}

// Function to list cloud assets in a project
async function listCloudAssets(assetClient, projectId) {
    try {
        console.log(`🔍 Listing cloud assets for project ${projectId}...`);

        // Define types of assets to list - empty array means all types
        const assetTypesList = [
            'compute.googleapis.com/Instance',
            'storage.googleapis.com/Bucket',
            'bigquery.googleapis.com/Dataset',
            'bigquery.googleapis.com/Table'
        ];

        const request = {
            parent: `projects/${projectId}`,
            assetTypes: assetTypesList,
            contentType: 'RESOURCE',
            // Optional: Add readTime parameter to list assets at a specific time
            // readTime: { seconds: Math.floor(Date.now() / 1000) },
        };

        // Call the Cloud Asset API to list assets
        const [assets] = await assetClient.listAssets(request);

        console.log(`Found ${assets.length} assets in project ${projectId}`);

        // Process and return the assets
        return assets.map(asset => ({
            name: asset.name,
            assetType: asset.assetType,
            resource: asset.resource
        }));
    } catch (error) {
        console.error(`Error listing cloud assets: ${error.message}`);
        return [];
    }
}

// List metric descriptors (using Monitoring Viewer role)
async function listMetricDescriptors(client, projectId) {
    try {
        console.log(
            `📊 Listing metric descriptors for project ${projectId}...`
        );

        const request = {
            name: `projects/${projectId}`,
        };

        // List the metric descriptors
        const [descriptors] = await client.listMetricDescriptors(request);

        console.log(`Found ${descriptors.length} metric descriptors`);
        return descriptors;
    } catch (error) {
        console.error(`Error listing metric descriptors: ${error.message}`);
        return [];
    }
}

// Get metric data for a specific resource (e.g., a VM instance)
async function getInstanceMetrics(client, projectId, instanceId, zone) {
    try {
        console.log(
            `🖥️ Fetching metrics for instance ${instanceId} in zone ${zone}...`
        );

        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour

        // CPU utilization metric
        const request = {
            name: `projects/${projectId}`,
            filter: `metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.labels.instance_id="${instanceId}"`,
            interval: {
                startTime: {
                    seconds: Math.floor(startTime.getTime() / 1000),
                    nanos: 0,
                },
                endTime: {
                    seconds: Math.floor(endTime.getTime() / 1000),
                    nanos: 0,
                },
            },
        };

        // Lists time series
        const [cpuTimeSeries] = await client.listTimeSeries(request);

        // Memory usage - if available
        const memoryRequest = {
            name: `projects/${projectId}`,
            filter: `metric.type="compute.googleapis.com/instance/memory/usage" AND resource.labels.instance_id="${instanceId}"`,
            interval: {
                startTime: {
                    seconds: Math.floor(startTime.getTime() / 1000),
                    nanos: 0,
                },
                endTime: {
                    seconds: Math.floor(endTime.getTime() / 1000),
                    nanos: 0,
                },
            },
        };

        const [memoryTimeSeries] = await client.listTimeSeries(memoryRequest);

        return {
            cpu: cpuTimeSeries,
            memory: memoryTimeSeries,
        };
    } catch (error) {
        console.error(`Error getting instance metrics: ${error.message}`);
        return { cpu: [], memory: [] };
    }
}

// List compute instances using native fetch
async function listComputeInstances(authClient, projectId) {
    try {
        const tokenResponse = await authClient.getAccessToken();
        const token = tokenResponse.token || tokenResponse;

        console.log(`💻 Listing compute instances for project ${projectId}...`);

        const response = await fetch(
            `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/instances`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        const instances = [];

        if (data && data.items) {
            for (const zone in data.items) {
                if (data.items[zone].instances) {
                    instances.push(...data.items[zone].instances);
                }
            }
        }

        console.log(`Found ${instances.length} compute instances`);
        return instances;
    } catch (error) {
        console.error(`Error listing compute instances: ${error.message}`);
        return [];
    }
}

async function fetchAllData() {
    try {
        console.log(`🔑 Authenticating using impersonation for: ${TARGET_SA}`);
        const authClient = await getImpersonatedAuthClient();

        console.log(`📋 Listing accessible projects...`);
        const projectIds = await listProjects(authClient);

        if (!projectIds.length) {
            console.log(`⚠️ No accessible projects found.`);
            return [];
        }

        console.log(`📊 Found ${projectIds.length} accessible projects.`);
        const results = [];

        // Create clients for different services
        const monitoringClient = await createMonitoringClient(authClient);
        const assetClient = await createAssetClient(authClient);

        for (const projectId of projectIds) {
            console.log(`🔍 Fetching data from project: ${projectId}`);

            const projectData = {
                projectId,
                instances: [],
                metrics: [],
                assets: []
            };

            // List compute instances
            const instances = await listComputeInstances(authClient, projectId);
            projectData.instances = instances.map((instance) => ({
                id: instance.id,
                name: instance.name,
                zone: instance.zone.split("/").pop(),
                machineType: instance.machineType.split("/").pop(),
                status: instance.status,
            }));

            // Get cloud assets
            const assets = await listCloudAssets(assetClient, projectId);
            projectData.assets = assets;

            // Get some common monitoring metrics (Monitoring Viewer role)
            // First, get a sample of metric descriptors
            const metricDescriptors = await listMetricDescriptors(
                monitoringClient,
                projectId
            );
            projectData.metrics = metricDescriptors
                .slice(0, 10)
                .map((descriptor) => ({
                    type: descriptor.type,
                    displayName: descriptor.displayName,
                    description: descriptor.description,
                }));

            // For each instance, get some metrics
            if (instances.length > 0) {
                const instanceMetrics = [];
                // Just get data for the first instance as an example
                const sampleInstance = instances[0];
                const instanceId = sampleInstance.id;
                const zone = sampleInstance.zone.split("/").pop();

                const metrics = await getInstanceMetrics(
                    monitoringClient,
                    projectId,
                    instanceId,
                    zone
                );

                instanceMetrics.push({
                    instanceName: sampleInstance.name,
                    instanceId: instanceId,
                    metrics: metrics,
                });

                projectData.instanceMetrics = instanceMetrics;
            }

            results.push(projectData);
            console.log(
                `✅ Completed data collection for project: ${projectId}`
            );
        }

        return results;
    } catch (error) {
        console.error(`❌ Main process error: ${error.message}`);
        return [];
    }
}

// Add API endpoint to fetch all data
app.get('/api/data', async (req, res) => {
    try {
        const data = await fetchAllData();
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add API endpoint for assets only
app.get('/api/assets/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const authClient = await getImpersonatedAuthClient();
        const assetClient = await createAssetClient(authClient);
        const assets = await listCloudAssets(assetClient, projectId);

        res.json({
            success: true,
            projectId,
            assets
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Call the function to fetch all data when starting the server
fetchAllData().then((results) => {
    if (results.length > 0) {
        console.log(
            `📊 Data collection complete. Access data via API endpoints.`
        );
    }
});

app.listen(port, () => {
    console.log(`🚀 App listening at http://localhost:${port}`);
});