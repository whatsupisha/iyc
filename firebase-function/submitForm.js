const functions = require("firebase-functions")
const {
  corsHandler,
  parseMultipartData,
  octokit,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  createNewPost,
  editPost,
  getOrCreateUserCookie,
  extractUserCookieFromRequest,
} = require("./library")

exports.submitForm = functions.region("asia-south1").https.onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    // Handle preflight OPTIONS request
    if (req.method === "OPTIONS") {
      res.status(200).send()
      return
    }

    // Only allow POST requests
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "Method not allowed. Only POST requests are accepted.",
      })
      return
    }

    try {
      // Check GitHub configuration
      if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        res.status(500).json({
          success: false,
          error: "GitHub configuration is missing. Please configure GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
        })
        return
      }

      // Parse multipart data with blog post specific options
      const { fields, files } = await parseMultipartData(req, {
        fileSize: 10 * 1024 * 1024, // 10MB limit for blog posts
        files: 10, // Allow multiple files
        imageOnly: true,
      })

      // Extract form data
      const { title, description, slug, date, deletedFiles } = fields

      // Extract user cookie from request headers with mandatory validation
      let userCookie
      try {
        userCookie = extractUserCookieFromRequest(req)
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error.message,
        })
        return
      }

      // Generate user cookie if extraction succeeds but cookie is empty (fallback)
      userCookie = getOrCreateUserCookie(userCookie)

      // Validate required fields
      if (!title || !description) {
        res.status(400).json({
          success: false,
          error: "Title and description are required fields.",
        })
        return
      }

      // Determine if this is an edit operation
      const isEdit = slug && slug.trim() !== ""

      let result
      if (isEdit) {
        // Parse deleted files if provided
        const deletedFilesList = deletedFiles ? deletedFiles.split(",").filter((f) => f.trim()) : []

        // Edit existing post
        result = await editPost(slug, date, title, description, files, deletedFilesList, userCookie)
      } else {
        // Create new post
        result = await createNewPost(title, description, files, userCookie)
      }

      // Send success response
      res.status(200).json(result)
    } catch (error) {
      console.error("Error in submitForm:", error)
      res.status(500).json({
        success: false,
        error: error.message || "An unexpected error occurred while processing your submission.",
      })
    }
  })
})
