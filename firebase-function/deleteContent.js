const functions = require("firebase-functions")
const yaml = require("js-yaml")
const {
  corsHandler,
  octokit,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  createSingleCommit,
  getPostPaths,
  getCommentPaths,
  generateOwnershipHash,
  extractUserCookieFromRequest,
} = require("./library")

exports.deleteContent = functions.region("asia-south1").https.onRequest((req, res) => {
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
          error: "GitHub configuration is missing.",
        })
        return
      }
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

      const { postSlug, postDate, commentId } = req.body

      // Validate required fields
      if (!postSlug) {
        res.status(400).json({
          success: false,
          error: "Post slug is required.",
        })
        return
      }

      // Check if userCookie matches (common check for both operations)
      const isCommentDeletion = commentId && commentId.trim() !== ""

      let filePath = null
      if (isCommentDeletion) {
        const { commentPath } = getCommentPaths(postSlug, postDate, commentId)
        filePath = commentPath
      } else {
        const { blogFilePath } = getPostPaths(postSlug, postDate)
        filePath = blogFilePath
      }
      // Get content and verify ownership
      const parsedContent = await getContent(filePath, isCommentDeletion)

      if (!parsedContent) {
        res.status(404).json({
          success: false,
          error: isCommentDeletion ? "Comment not found." : "Post not found.",
        })
        return
      }

      const computedHash = generateOwnershipHash(userCookie)
      if (!parsedContent.cookie_hash || parsedContent.cookie_hash !== computedHash) {
        res.status(403).json({
          success: false,
          error: isCommentDeletion ? "You can only delete your own comments." : "You can only delete your own posts.",
        })
        return
      }

      // Initialize files to delete array
      const filesToDelete = []
      let commitMessage = ""

      if (isCommentDeletion) {
        // Comment deletion logic
        console.log(`Attempting to delete comment: ${commentId} from post: ${postSlug}`)

        // Add comment file to deletion list
        filesToDelete.push({
          path: filePath,
          content: null,
          encoding: null, // This marks the file for deletion
        })

        await addImageToDelete(parsedContent.image, postSlug, postDate, filesToDelete)
        commitMessage = `Delete comment ${commentId} from post: ${postSlug}`
      } else {
        // Post deletion logic
        console.log(`Attempting to delete post: ${postSlug}`)

        const { postDirPath } = getPostPaths(postSlug, postDate)
        const { commentDirPath } = getCommentPaths(postSlug, postDate)

        await addFilesFromDirectoryToDelete(postDirPath, filesToDelete)
        await addFilesFromDirectoryToDelete(commentDirPath, filesToDelete)

        console.log(`Files to delete: ${filesToDelete.map((f) => f.path).join(", ")}`)

        if (filesToDelete.length === 0) {
          return res.status(404).json({
            success: false,
            error: "No files found for the specified post slug",
          })
        }

        commitMessage = `Delete post: ${postSlug}`
      }

      // Use createSingleCommit to delete all files in one commit
      const result = await createSingleCommit(filesToDelete, commitMessage)

      // Send success response
      res.status(200).json(result)
    } catch (error) {
      console.error("Error in deleteContent:", error)
      res.status(500).json({
        success: false,
        error: error.message || "An unexpected error occurred while deleting content.",
      })
    }
  })
})

async function getContent(path, isCommentDeletion) {
  try {
    const contentResponse = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: path,
      ref: GITHUB_BRANCH,
    })

    const contentToVerify = Buffer.from(contentResponse.data.content, "base64").toString("utf-8")

    if (!isCommentDeletion) {
      // For posts, extract frontmatter
      const frontmatterMatch = contentToVerify.match(/^---\n([\s\S]*?)\n---/)
      if (frontmatterMatch) {
        return yaml.load(frontmatterMatch[1])
      }
    }
    // For comments, parse entire YAML content
    return yaml.load(contentToVerify)
  } catch (error) {
    if (error.status === 404) {
      return null
    }
    throw error
  }
}

async function addFilesFromDirectoryToDelete(path, filesToDelete) {
  try {
    const dirResponse = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: path,
      ref: GITHUB_BRANCH,
    })

    // Add all files from directory
    if (Array.isArray(dirResponse.data)) {
      dirResponse.data.forEach((item) => {
        if (item.type === "file") {
          filesToDelete.push({
            path: item.path,
            content: null,
            encoding: null, // This marks the file for deletion
          })
        }
      })
    }
  } catch (error) {
    if (error.status !== 404) {
      throw error
    }
    // Directory doesn't exist, continue
  }
}

async function addImageToDelete(imageUrl, postSlug, postDate, filesToDelete) {
  // Check if comment has an associated image using the parsed YAML
  if (imageUrl) {
    // Extract filename from the GitHub URL
    const urlMatch = imageUrl.match(
      /https:\/\/github\.com\/[^\/]+\/[^\/]+\/blob\/[^\/]+\/_posts\/[^\/]+\/(.+)\?raw=true/
    )
    if (urlMatch) {
      const imageFileName = urlMatch[1]
      const { imagePath } = getPostPaths(postSlug, postDate, imageFileName)
      filesToDelete.push({
        path: imagePath,
        content: null,
        encoding: null, // This marks the file for deletion
      })
    }
  }
}
