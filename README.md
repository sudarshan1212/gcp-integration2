# GCP Integration using Service Account 

This project enables secure and scalable **Google Cloud Platform (GCP) integration using service account impersonation**, allowing you to collect monitoring data (logs, metrics, compute inventory, etc.) across multiple GCP projects.

It simplifies GCP data collection, accelerates implementation, and promotes best practices for secure impersonation. This model is especially suited for ISVs, observability platforms, or teams building custom integrations with their own backend logic.

---

## 1. Main Service Account

Create a main service account in your GCP project (e.g., `own-code@your-project.iam.gserviceaccount.com`). This account will perform impersonation.

---

## 2. User Project Setup

Ask the user to:

### a. Create a Service Account in Their Project
- Example: `monitoring-reader@user-project.iam.gserviceaccount.com`

### b. Grant Required Roles to Their Service Account
These roles allow the account to access monitoring and infrastructure data:
- **Monitoring Viewer** – to read metrics (e.g. CPU usage)
- **Compute Viewer** – to read VM instance information
- **Cloud Asset Viewer** – to read asset inventory
- **Browser** – to list project metadata (`resourcemanager.projects.list`)

### c. Allow Your Main Service Account to Impersonate
In the IAM permissions of the user’s service account:

1. Go to the IAM page of the user's project.
2. Click the **"Add"** button to add a new principal.
3. In the **"New principals"** field, paste the **Main Service Account** email (e.g., `own-code@your-project.iam.gserviceaccount.com`).
4. Under **Roles**, select the role:
   - `roles/iam.serviceAccountTokenCreator`
5. Click **Save** to grant the necessary permissions.

This grants your main service account the ability to impersonate the user’s service account securely.

---

## 3. Backend Workflow

From your backend:

### a. Authenticate with Main Service Account
Use your main service account's key (JSON file or environment auth).

### b. Impersonate the User's Service Account
Use the Google Auth Library to impersonate the target user service account.

### c. Call GCP APIs
After impersonation, use the impersonated credentials to make API calls such as:
- **Compute Engine API** – to fetch instances
- **Cloud Monitoring API** – to fetch metrics
- **Cloud Asset API** – to fetch asset data
- **Resource Manager API** – to list available projects

---

## 4. API Flow Summary

1. Main account authenticates.
2. Main account impersonates user's service account.
3. Impersonated credentials are used to call GCP APIs.
4. Data is collected securely without exposing.

---

## Example Code
> See `/src/working.js` for an example of how to implement the impersonation and data collection flow using Node.js and Google Auth Library.

---


