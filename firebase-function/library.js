const functions = require("firebase-functions")
const admin = require("firebase-admin")
const { Octokit } = require("@octokit/rest")
const cors = require("cors")
const busboy = require("busboy")
const { v4: uuidv4 } = require("uuid")
const crypto = require("crypto")

// Initialize Firebase Admin SDK
admin.initializeApp()

// GitHub configuration
// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_OWNER = process.env.GITHUB_OWNER
const GITHUB_REPO = process.env.GITHUB_REPO
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "master"

// Initialize Octokit
const octokit = new Octokit({
  auth: GITHUB_TOKEN,
})

// CORS configuration
const corsHandler = cors({
  origin: ["https://whatsupisha.github.io", "https://whatsupisha.com"],
  methods: ["GET", "POST", "OPTIONS"],
})

// Centralized path management function
function getPostPaths(slug, date, imageFileName = null) {
  const postDirPath = `_posts/${date}-${slug}`
  const blogFilePath = `${postDirPath}/index.md`

  const paths = {
    postDirPath,
    blogFilePath,
  }

  // Add imagePath if imageFileName is provided
  if (imageFileName) {
    paths.imagePath = `${postDirPath}/${imageFileName}`
  }

  return paths
}

function getCommentPaths(slug, date, commentId = null, imageFileName = null) /* */ {
  const now = new Date()
  const { postDirPath } = getPostPaths(slug, date)

  const commentDirPath = `_data/comments/${date}-${slug}`
  const timeStr = now
    .toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(/[/,: ]/g, "-")
  const commentFileName = commentId || `comment-${timeStr}`
  const commentPath = `${commentDirPath}/${commentFileName}.yml`

  return {
    commentDirPath,
    commentPath,
    commentImagePath: imageFileName ? `${postDirPath}/comment-${imageFileName}` : null, // the "comment-" prefix ensures filtering images for inclusion in the post
  }
}

// Function to get existing comment content
async function getCommentContent(commentPath) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: commentPath,
      ref: GITHUB_BRANCH,
    })

    if (response.data.content) {
      const content = Buffer.from(response.data.content, "base64").toString("utf-8")
      return content
    }
    return null
  } catch (error) {
    if (error.status === 404) {
      return null // Comment doesn't exist yet
    }
    throw error
  }
}
// Shared function to parse multipart form data using Busboy
const parseMultipartData = (req, options = {}) => {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      fileSize: 10 * 1024 * 1024, // 10MB default
      files: 1,
      fields: 10,
      imageOnly: true, // whether to restrict to images only
    }

    const config = { ...defaultOptions, ...options }

    // Check if request has multipart content-type
    const contentType = req.headers["content-type"] || ""
    if (!contentType.includes("multipart/form-data")) {
      reject(new Error("Invalid content type. Expected multipart/form-data."))
      return
    }

    // Parse multipart form data using Busboy
    const busboyInstance = busboy({
      headers: req.headers,
      limits: {
        fileSize: config.fileSize,
        files: config.files,
        fields: config.fields,
      },
    })

    const fields = {}
    const files = []

    // Handle form fields
    busboyInstance.on("field", (fieldname, val) => {
      fields[fieldname] = val
    })

    // Handle file uploads
    busboyInstance.on("file", (fieldname, file, info) => {
      const { filename, mimeType } = info

      // Validate file type if imageOnly is true
      if (config.imageOnly && !mimeType.startsWith("image/")) {
        file.resume() // Consume the stream
        reject(new Error(`Invalid file type: ${mimeType}. Only images are allowed.`))
        return
      }

      const chunks = []
      file.on("data", (chunk) => {
        chunks.push(chunk)
      })

      file.on("end", () => {
        const fileBuffer = Buffer.concat(chunks)
        files.push({
          fieldname,
          filename,
          mimeType,
          buffer: fileBuffer,
        })
      })

      file.on("error", (err) => {
        reject(new Error(`File processing error: ${err.message}`))
      })
    })

    // Handle parsing completion
    busboyInstance.on("finish", () => {
      resolve({ fields, files })
    })

    // Handle parsing errors
    busboyInstance.on("error", (err) => {
      reject(new Error(`Parsing error: ${err.message}`))
    })

    // Pipe the request to busboy
    // Handle Firebase Functions request body
    if (req.rawBody) {
      busboyInstance.end(req.rawBody)
    } else {
      // For Firebase Functions, we need to read the request body
      let body = Buffer.alloc(0)
      req.on("data", (chunk) => {
        body = Buffer.concat([body, chunk])
      })
      req.on("end", () => {
        busboyInstance.end(body)
      })
    }
  })
}

// Helper function to generate user cookie
const generateUserCookie = () => {
  return uuidv4()
}

// Helper function to get or create user cookie
const getOrCreateUserCookie = (existingCookie) => {
  return existingCookie && existingCookie.trim() !== "" ? existingCookie : generateUserCookie()
}

// Helper function to extract user cookie from request headers with mandatory validation
const extractUserCookieFromRequest = (req) => {
  // Extract user cookie from request headers
  let userCookie = req.headers["x-user-cookie"] || req.headers["cookie"]?.match(/forum_user_id=([^;]+)/)?.[1] || null

  // Mandatory cookie check - fail fast if not found
  if (!userCookie || userCookie.trim() === "") {
    throw new Error("User cookie is required but not found in request headers")
  }

  return userCookie.trim()
}

// Helper function to generate ownership hash
const generateOwnershipHash = (userCookie) => {
  const siteSecret = process.env.SITE_SECRET
  const message = userCookie + siteSecret
  return crypto.createHash("sha256").update(message).digest("hex").substring(0, 16)
}
// Generic function to create a single commit with multiple files
async function createSingleCommit(files, commitMessage) {
  try {
    // Get the latest commit SHA from the target branch
    const { data: refData } = await octokit.rest.git.getRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: `heads/${GITHUB_BRANCH}`,
    })

    const latestCommitSha = refData.object.sha

    // Get the tree SHA of the latest commit
    const { data: commitData } = await octokit.rest.git.getCommit({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      commit_sha: latestCommitSha,
    })

    const baseTreeSha = commitData.tree.sha

    // Create tree with all file operations (create/update/delete)
    const tree = []

    // Handle file operations
    if (files && files.length > 0) {
      for (const file of files) {
        if (file.encoding === "base64") {
          // For binary files, create blob first
          const { data: blobData } = await octokit.rest.git.createBlob({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            content: file.content,
            encoding: "base64",
          })

          tree.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: blobData.sha,
          })
        } else if (file.encoding === null) {
          // delete files
          tree.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: null,
          })
        } else {
          // For text files, use content directly
          tree.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            content: file.content,
          })
        }
      }
    }

    const { data: treeData } = await octokit.rest.git.createTree({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      base_tree: baseTreeSha,
      tree: tree,
    })

    // Create commit
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      message: commitMessage,
      tree: treeData.sha,
      parents: [latestCommitSha],
    })

    // Update the branch reference
    await octokit.rest.git.updateRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: `heads/${GITHUB_BRANCH}`,
      sha: newCommit.sha,
    })

    return {
      success: true,
      commitSha: newCommit.sha,
      githubUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/commit/${newCommit.sha}`,
    }
  } catch (error) {
    console.error("Error creating single commit:", error)
    throw error
  }
}

// Function to create a new blog post with multiple images
async function createNewPost(title, description, files, userCookie) {
  try {
    const now = new Date()
    const dateStr = now.toISOString().split("T")[0] // YYYY-MM-DD format
    const postDate = now.toISOString()

    // Create slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim("-")

    // Create directory name for the blog post
    // Get centralized paths
    const paths = getPostPaths(slug, dateStr)
    const { postDirPath, blogFilePath } = paths

    // Create Jekyll front matter and content
    let postContent = `---
layout: post
title: "${title}"
date: ${postDate}
author: Anonymous
slug: ${slug}
cookie_hash: ${generateOwnershipHash(userCookie)}
---

${description}

`

    // Prepare files for single commit
    const filesToProcess = []

    // Handle multiple images
    if (files && files.length > 0) {
      files.forEach((file, index) => {
        if (file.mimeType && file.mimeType.startsWith("image/")) {
          const { imagePath } = getPostPaths(slug, dateStr, file.filename)

          // Add image reference to post content
          postContent += `
![${file.filename}](https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/${imagePath}?raw=true)
`

          // Add image file to processing queue
          filesToProcess.push({
            path: imagePath,
            content: file.buffer.toString("base64"),
            encoding: "base64",
          })
        }
      })
    }

    // Add the blog post markdown file
    filesToProcess.push({
      path: blogFilePath,
      content: postContent,
      encoding: "utf-8",
    })

    // Create single commit with all files
    return await createSingleCommit(filesToProcess, `Create new blog post: ${title}`)
  } catch (error) {
    console.error("Error creating new post:", error)
    throw error
  }
}

// Function to edit an existing blog post with multiple images
async function editPost(slug, date, title, description, files, deletedFiles, userCookie) {
  try {
    // Construct the path using the slug pattern
    // Get centralized paths
    const paths = getPostPaths(slug, date)
    const { postDirPath, blogFilePath } = paths

    // Get the existing post content to verify user ownership
    let existingFile, existingContent
    try {
      const response = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: blogFilePath,
        ref: GITHUB_BRANCH,
      })
      existingFile = response.data
      existingContent = Buffer.from(existingFile.content, "base64").toString("utf-8")

      // Check if the user cookie matches the one in the existing post
      const cookieMatch = existingContent.match(/cookie_hash:\s*(.+)/)
      const storedHash = cookieMatch ? cookieMatch[1].trim() : null
      const computedHash = generateOwnershipHash(userCookie)

      if (storedHash !== computedHash) {
        throw new Error("Unauthorized: You can only edit posts you created")
      }
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`Post not found: ${slug}`)
      }
      throw new Error("Unauthorized: You can only edit posts you created")
    }

    // Create updated Jekyll front matter and content
    let postContent = `---
layout: post
title: "${title}"
date: ${date}
author: Anonymous
slug: ${slug}
cookie_hash: ${generateOwnershipHash(userCookie)}
---

${description}

`

    // Prepare files for single commit
    const filesToProcess = []

    // Get existing images from the post directory
    let existingImages = []
    try {
      const dirResponse = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: postDirPath,
        ref: GITHUB_BRANCH,
      })

      if (Array.isArray(dirResponse.data)) {
        existingImages = dirResponse.data.filter(
          (file) => file.type === "file" && file.name !== "index.md" && /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)
        )
      }
    } catch (error) {
      console.log("No existing images found or directory doesn't exist")
    }

    if (deletedFiles && deletedFiles.length > 0) {
      deletedFiles.forEach((deletedFileName) => {
        const fileToDelete = existingImages.find((img) => img.name === deletedFileName)
        if (fileToDelete) {
          filesToProcess.push({
            path: fileToDelete.path,
            content: null,
            encoding: null,
          })
        }
      })
    }

    // Add remaining existing images to post content (those not deleted)
    existingImages.forEach((image) => {
      if ((!deletedFiles || !deletedFiles.includes(image.name)) && !image.name.startsWith("comment-")) {
        postContent += `
![${image.name}](https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/${image.path}?raw=true)
`
      }
    })

    // Handle new images
    if (files && files.length > 0) {
      files.forEach((file, index) => {
        if (file.mimeType && file.mimeType.startsWith("image/")) {
          const { imagePath } = getPostPaths(slug, date, file.filename)

          // Add image reference to post content
          postContent += `
![${file.filename}](https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/${imagePath}?raw=true)
`

          // Add image file to processing queue
          filesToProcess.push({
            path: imagePath,
            content: file.buffer.toString("base64"),
            encoding: "base64",
          })
        }
      })
    }

    // Add the updated blog post markdown file
    filesToProcess.push({
      path: blogFilePath,
      content: postContent,
      encoding: "utf-8",
    })

    // Create single commit with all updated/new files
    return await createSingleCommit(filesToProcess, `Update blog post: ${title}`)
  } catch (error) {
    console.error("Error editing post:", error)
    throw error
  }
}

// Export all functions and constants
module.exports = {
  corsHandler,
  parseMultipartData,
  octokit,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  createSingleCommit,
  generateUserCookie,
  getOrCreateUserCookie,
  extractUserCookieFromRequest,
  createNewPost,
  editPost,
  getPostPaths,
  getCommentPaths,
  getCommentContent,
  generateOwnershipHash,
}
