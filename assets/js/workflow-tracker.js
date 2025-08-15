class WorkflowTracker {
  constructor() {
    this.activeSubmissions = this.loadActiveSubmissions()
    this.checkAndApplyPageRestrictions()
  }

  // Load active submissions from localStorage
  loadActiveSubmissions() {
    try {
      const stored = localStorage.getItem("activeSubmissions")
      return stored ? JSON.parse(stored) : {}
    } catch (error) {
      console.error("Error loading active submissions:", error)
      return {}
    }
  }

  // Save active submissions to localStorage
  saveActiveSubmissions() {
    try {
      localStorage.setItem("activeSubmissions", JSON.stringify(this.activeSubmissions))
    } catch (error) {
      console.error("Error saving active submissions:", error)
    }
  }

  // Track a new submission
  trackSubmission(url, submissionId, operation, commitSha, createdAt) {
    this.activeSubmissions[url] = {
      submissionId: submissionId,
      operation: operation,
      commitSha: commitSha,
      timestamp: createdAt,
    }
    this.saveActiveSubmissions()
    console.log(`Tracking submission: ${url} with commit SHA ${commitSha}`)
    // enable page blocking .. ideally this should be with await but there will not be any API call so we should be good
    this.checkAndApplyPageRestrictions(false)
  }

  // Check current page and apply restrictions based on active submissions
  async checkAndApplyPageRestrictions(cleanupOldSubmissions = true) {
    if (!this.activeSubmissions || this.activeSubmissions == {}) return

    const currentUrl = window.location.href

    // Iterate through each active submission to see if current URL is affected
    for (const [url, submission] of Object.entries(this.activeSubmissions)) {
      const { submissionId, operation } = submission //submissionId is slug for post & commentId for comment

      const urlParams = new URLSearchParams(window.location.search)
      const isEditPage = urlParams.get("edit") === null ? false : true

      if (currentUrl === url) {
        if (operation === "new_post") this.disableNewPostForm()
        if (operation === "edit_post") this.disablePostEditForm("edit")
        if (operation === "delete_post") this.disablePostEditDeleteButtons(submissionId, "delete")
        if (operation === "new_comment") this.disableNewCommentFormOnPost()
        if (operation === "edit_comment" || operation === "delete_comment")
          this.disableCommentEditDeleteButton(submissionId)
      } else if (currentUrl.includes(submissionId)) {
        if (isEditPage) {
          // on edit page of a post getting deleted
          this.disablePostEditForm("delete")
        } else {
          // on post view page of post getting edited
          this.disablePostEditDeleteButtons(submissionId, "edit")
        }
      }
    }

    this.processAndShowNotification()

    // Clean up old submissions at the end
    if (cleanupOldSubmissions) await this.cleanupOldSubmissions()
  }

  processAndShowNotification() {
    if (this.activeSubmissions && Object.entries(this.activeSubmissions).length > 0) {
      const [url, submission] = Object.entries(this.activeSubmissions)[0] // getting the oldest entry
      const { lastRun, timestamp, operation, submissionId, lastChecked } = submission

      let title = `Backend is yet to start processing ${operation} operation`
      let description = `Refresh the page after ${new Date(timestamp + 30000).toLocaleTimeString()} for an update`

      if (lastRun) {
        const { status, conclusion, createdAt } = lastRun
        title = `${operation} operation status at backend is ${status}`
        description = `Operation lifecycle - pending, queued, in-progress, completed. Refresh the page after ${new Date(
          lastChecked + 30000
        ).toLocaleTimeString()} for an update`
      }

      this.showNotification(title, description)
    }
  }

  // Handle new post page restrictions
  disableNewPostForm() {
    const postForm = document.getElementById("submissionForm")
    const submitButton = document.getElementById("submitBtn")

    this.blockForm(
      postForm,
      submitButton,
      "Post is submitted & backend is processing it...",
      "Submit Post",
      "Submission in Progress..."
    )
  }

  // Handle edit page restrictions
  disablePostEditForm(conflictType = "edit") {
    const editForm = document.getElementById("submissionForm")
    const submitButton = document.getElementById("submitBtn")

    let message = "An edit submission is already in progress for this post. Please wait for it to complete."
    let progressText = "Edit in Progress..."

    if (conflictType === "delete") {
      message = "This post is currently being deleted. Edit is not available."
      progressText = "Post Being Deleted..."
    }

    this.blockForm(editForm, submitButton, message, "Update Post", progressText)
  }

  // Handle post view page - grey out edit/delete links based on active operations
  disablePostEditDeleteButtons(postSlug, operationType) {
    const buttons = []
    buttons.push(document.getElementById("editPostBtn"))
    buttons.push(document.getElementById("deletePostBtn"))

    buttons.forEach((link) => {
      link.style.opacity = "0.5"
      link.style.pointerEvents = "none"
      link.style.cursor = "not-allowed"
    })
  }

  // Handle comment form restrictions
  disableNewCommentFormOnPost() {
    const commentForm = document.getElementById("commentForm")
    const commentSubmitButton = document.getElementById("commentSubmitBtn")

    this.blockForm(
      commentForm,
      commentSubmitButton,
      "Comment operation is in progress...",
      "Submit Comment",
      "Processing..."
    )
  }

  // Handle edit/delete buttons for comments
  disableCommentEditDeleteButton(commentId) {
    const editButtons = document.querySelectorAll(
      `[data-comment-id="${commentId}"] .edit-comment-btn, .edit-comment-btn[data-comment-id="${commentId}"]`
    )
    const deleteButtons = document.querySelectorAll(
      `[data-comment-id="${commentId}"] .delete-comment-btn, .delete-comment-btn[data-comment-id="${commentId}"]`
    )

    editButtons.forEach((button) => {
      button.disabled = true
      button.style.opacity = "0.5"
      button.style.cursor = "not-allowed"
    })

    deleteButtons.forEach((button) => {
      button.disabled = true
      button.style.opacity = "0.5"
      button.style.cursor = "not-allowed"
    })
  }

  // Block form elements
  blockForm(form, submitButton, message, originalText, progressText) {
    if (form) {
      form.style.opacity = "0.5"
      form.style.pointerEvents = "none"
    }
    if (submitButton) {
      submitButton.disabled = true
      submitButton.textContent = progressText
      submitButton.style.cursor = "not-allowed"
    }
  }

  // Show notification to user
  showNotification(title, message = null) {
    const notificationTitle = document.getElementById("notificationTitle")
    notificationTitle.textContent = title
    if (message) {
      const notificationDescription = document.getElementById("notificationDescription")
      notificationDescription.textContent = message
    }
    const notification = document.getElementById("notification")
    notification.classList.remove("hidden")
  }

  // Check workflow status (placeholder for future implementation)
  // Retrieve workflow information for a commit SHA
  // Retrieve workflow information for a commit SHA
  async checkWorkflowStatus(commitSha) {
    try {
      console.log(`Checking workflow status for commit SHA: ${commitSha}`)

      // Use Firebase function to get workflow status

      const url = `${window.firebaseUrl}/checkWorkflow?sha=${commitSha}`

      console.log(`Making request to: ${url}`)

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      console.log("Workflow status received:", result)

      // Return standardized status object
      return result
    } catch (error) {
      console.error("Error checking workflow status:", error)

      // If API call fails, assume workflow might be completed after reasonable time
      // This prevents indefinite blocking if the API is down
      return {
        status: "error",
        conclusion: String.toString(error),
        createdAt: null,
      }
    }
  }

  // Clean up old submissions
  async cleanupOldSubmissions() {
    const now = Date.now()
    let updated = false

    let submissionsRemoved = []

    for (const [url, submission] of Object.entries(this.activeSubmissions)) {
      let timeDiff = now - submission.timestamp
      if (submission.lastChecked) {
        timeDiff = now - submission.lastChecked
      }

      // give 30 sec gap so not to check too often
      if (timeDiff > 0.5 * 60 * 1000) {
        try {
          const workflowStatus = await this.checkWorkflowStatus(submission.commitSha)
          if (["completed", "cancelled", "timed_out"].includes(workflowStatus.status)) {
            console.log(
              `Workflow for commit ${submission.commitSha} status changed to ${workflowStatus.status}, removing from tracking`
            )

            const clonedObject = JSON.parse(JSON.stringify(this.activeSubmissions[url]))
            submissionsRemoved.push(clonedObject)

            delete this.activeSubmissions[url]
          } else {
            const submission = this.activeSubmissions[url]
            submission.lastRun = workflowStatus
            submission.lastChecked = Date.now()
          }
          updated = true
        } catch (error) {
          console.error(`Error checking workflow status for ${url}:`, error)
        }
      }

      // If error and older than 10 minutes, remove anyway
      if (timeDiff > 10 * 60 * 1000) {
        console.log(`Workflow ${submission.commitSha} been there for more than 10 min, removing from tracking`)
        delete this.activeSubmissions[url]
        updated = true
      }
    }

    if (updated) this.saveActiveSubmissions()

    submissionsRemoved.forEach((submission) => {
      this.showCompletionNotification(
        `${submission.operation} is now complete. Your (updated) post/comment is now live.`
      )
    })
  }

  // TODO - there should be a container to which multiple notification should be stacked on the top
  showCompletionNotification(message) {
    const notification = document.getElementById("notification")
    notification.classList.add("hidden")

    const completedNotification = document.createElement("div")
    completedNotification.className = "completion-notification"
    completedNotification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #1fa445ff;
    color: white;
    padding: 15px 20px;
    border-radius: 5px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    max-width: 600px;
    min-width: 400px;
    font-size: 14px;
    line-height: 1.4;
  `
    completedNotification.textContent = message

    document.body.appendChild(completedNotification)
  }
}

// Initialize workflow tracker when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  window.workflowTracker = new WorkflowTracker()
  // window.workflowTracker.checkAndApplyPageRestrictions()
  // checkAndApplyPageRestriction() already launched from the constructor
})

// Export for use in other scripts
if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowTracker
}
