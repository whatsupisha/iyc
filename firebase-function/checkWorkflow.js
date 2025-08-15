const functions = require("firebase-functions")
const { octokit, corsHandler, GITHUB_OWNER, GITHUB_REPO } = require("./library")

/**
 * Firebase function to check GitHub workflow status
 * Accepts commit SHA and returns workflow run information
 */
const checkWorkflow = functions.region("asia-south1").https.onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      // Only allow GET requests
      if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" })
      }

      const { sha } = req.query

      if (!sha) {
        return res.status(400).json({ error: "Missing required parameter: sha" })
      }

      console.log(`Checking workflow for commit SHA: ${sha}`)

      // Query GitHub API for workflow runs with the specific commit SHA
      const response = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        head_sha: sha,
        per_page: 10,
      })

      console.log(`Found ${response.data.total_count} workflow runs for SHA: ${sha}`)

      if (response.data.total_count == 0) {
        // Workflow is not yet created
        return res.status(200).json({
          status: "pending",
          conclusion: null,
          createdAt: null,
        })
      }

      // Return the most recent workflow run data
      const latestRun = response.data.workflow_runs[0]
      return res.status(200).json({
        status: latestRun.status,
        conclusion: latestRun.conclusion,
        createdAt: latestRun.created_at,
      })
    } catch (error) {
      console.error("Error checking workflow:", error)
      return res.status(500).json({
        error: "Failed to check workflow status",
        details: error.message,
      })
    }
  })
})

module.exports = { checkWorkflow }
