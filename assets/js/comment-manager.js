async function submitCommentForm(formData, imageElementId, operation) {
  const imageInput = document.getElementById(imageElementId)
  if (!imageInput.files || imageInput.files.length === 0 || imageInput.files[0].size === 0) {
    formData.delete("image")
  }

  const response = await fetch(`${window.firebaseUrl}/submitComment`, {
    method: "POST",
    headers: {
      "x-user-cookie": getCookie(),
    },
    body: formData,
  })

  const result = await response.json()

  if (result.success) {
    if (window.workflowTracker && result.commitSha) {
      let submissionId = null
      if (operation === "edit_comment") {
        submissionId = document.getElementById("editCommentId").value
      }

      window.workflowTracker.trackSubmission(
        operation === "edit_comment" ? window.location.href.split("?")[0] : window.location.href,
        submissionId,
        operation,
        result.commitSha,
        Date.now()
      )
    }
  }

  return result
}

document.getElementById("commentForm").addEventListener("submit", async function (e) {
  e.preventDefault()

  const statusDiv = document.getElementById("commentStatus")
  const submitBtn = e.target.querySelector('button[type="submit"]')

  // Show loading state
  submitBtn.disabled = true
  submitBtn.textContent = "Submitting..."
  statusDiv.textContent = "Submitting your comment..."
  statusDiv.className = "text-sm text-blue-600"

  const formData = new FormData(e.target)

  // Ensure user has a cookie (create if first time)
  getOrSetUserCookie()

  try {
    const result = await submitCommentForm(formData, "image", "new_comment")

    if (result.success) {
      statusDiv.textContent = "Comment submitted successfully! It will appear after the site rebuilds."
      statusDiv.className = "text-sm text-green-600"
      e.target.reset() // Clear the form
    } else {
      throw new Error(result.error || "Failed to submit comment")
    }
  } catch (error) {
    console.error("Error submitting comment:", error)
    statusDiv.textContent = "Error submitting comment: " + error.message
    statusDiv.className = "text-sm text-red-600"
  } finally {
    // Reset button state
    submitBtn.disabled = false
    submitBtn.textContent = "Submit Comment"
  }
})

// Comment ownership and edit/delete functionality
async function revealCommentActionsIfRequired() {
  const userCookie = getCookie()
  if (!userCookie) return

  const commentActions = document.querySelectorAll(".comment-owner-actions")

  for (const action of commentActions) {
    const commentCookieHash = action.getAttribute("data-cookie-hash")
    if (commentCookieHash && (await verifyOwnership(commentCookieHash))) {
      action.style.display = "block"
    }
  }
}

document.getElementById("editCommentForm").addEventListener("submit", async function (e) {
  e.preventDefault()

  const statusDiv = document.getElementById("editCommentStatus")
  const submitBtn = e.target.querySelector('button[type="submit"]')
  const originalBtnText = submitBtn.innerHTML

  // Show loading state
  submitBtn.innerHTML =
    '<svg class="w-4 h-4 inline mr-1 animate-spin" fill="currentColor" viewBox="0 0 20 20"><path d="M4 2a2 2 0 00-2 2v12a2 2 0 002-2V4a2 2 0 00-2-2H4z"></path></svg>Updating...'
  submitBtn.disabled = true
  statusDiv.className = "mb-4 hidden"

  const formData = new FormData(e.target)

  try {
    const data = await submitCommentForm(formData, "editCommentImage", "edit_comment")

    if (data.success) {
      statusDiv.innerHTML =
        '<div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">Comment updated successfully! The page will refresh shortly.</div>'
      statusDiv.className = "mb-4"

      setTimeout(() => {
        closeEditFormModal()
        window.location.reload() // reloading as the edit & delete button will not be disabled by simply closing the modal
      }, 2000)
    } else {
      throw new Error(data.error || "Failed to update comment")
    }
  } catch (error) {
    console.error("Error updating comment:", error)
    statusDiv.innerHTML = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">Error updating comment: ${error.message}</div>`
    statusDiv.className = "mb-4"
  } finally {
    // Reset button
    submitBtn.innerHTML = originalBtnText
    submitBtn.disabled = false
  }
})

// Edit comment functionality
function showEditCommentPopup(commentId, commentText, commentImage) {
  const modal = document.getElementById("editCommentModal")
  const commentIdInput = document.getElementById("editCommentId")
  const commentTextArea = document.getElementById("editCommentText")
  const currentImageDiv = document.getElementById("currentCommentImage")
  const currentImagePreview = document.getElementById("currentCommentImagePreview")

  // Set form values
  commentIdInput.value = commentId
  commentTextArea.value = commentText

  // Handle current image
  if (commentImage && commentImage.trim() !== "") {
    currentImageDiv.classList.remove("hidden")
    currentImagePreview.src = commentImage
  } else {
    currentImageDiv.classList.add("hidden")
  }

  // Update URL
  const url = new URL(window.location)
  url.searchParams.set("editComment", commentId)
  window.history.pushState({}, "", url)

  // Show modal
  modal.classList.remove("hidden")
}

// Delete comment functionality
function handleDeleteComment(commentId, postDate) {
  if (!confirm("Are you sure you want to delete this comment? This action cannot be undone.")) {
    return
  }

  // Find the comment element and show loading state
  const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`)
  const deleteBtn = commentElement.querySelector(".delete-comment-btn")
  const originalText = deleteBtn.innerHTML
  deleteBtn.innerHTML =
    '<svg class="w-3 h-3 inline mr-1 animate-spin" fill="currentColor" viewBox="0 0 20 20"><path d="M4 2a2 2 0 00-2 2v12a2 2 0 002-2V4a2 2 0 00-2-2H4z"></path></svg>Deleting...'
  deleteBtn.disabled = true
  fetch(`${window.firebaseUrl}/deleteContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-cookie": getCookie(),
    },
    body: JSON.stringify({
      postSlug: window.postSlug,
      postDate: postDate,
      commentId: commentId,
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        if (window.workflowTracker && data.commitSha) {
          window.workflowTracker.trackSubmission(
            window.location.href,
            commentId,
            "delete_comment",
            data.commitSha,
            Date.now()
          )
        }

        alert("Comment deleted successfully!")
        window.location.reload()
      } else {
        throw new Error(data.error || "Failed to delete comment")
      }
    })
    .catch((error) => {
      console.error("Error deleting comment:", error)
      alert("Error deleting comment: " + error.message)
      // Restore button state
      deleteBtn.innerHTML = originalText
      deleteBtn.disabled = false
    })
}

// Event listeners for comment actions
document.addEventListener("click", function (e) {
  if (e.target.closest(".edit-comment-btn")) {
    const btn = e.target.closest(".edit-comment-btn")
    const commentId = btn.getAttribute("data-comment-id")
    const postDate = btn.getAttribute("data-post-date")
    const commentText = btn.getAttribute("data-comment-text")
    const commentImage = btn.getAttribute("data-comment-image")
    showEditCommentPopup(commentId, commentText, commentImage)
  }

  if (e.target.closest(".delete-comment-btn")) {
    const btn = e.target.closest(".delete-comment-btn")
    const commentId = btn.getAttribute("data-comment-id")
    const postDate = btn.getAttribute("data-post-date")
    handleDeleteComment(commentId, postDate)
  }
})

function closeEditFormModal() {
  document.getElementById("editCommentModal").classList.add("hidden")
  // Remove URL parameter
  const url = new URL(window.location)
  url.searchParams.delete("editComment")
  window.history.pushState({}, "", url)
}

const buttonsForClosingEditpop = [
  document.getElementById("closeEditCommentModal"),
  document.getElementById("cancelEditComment"),
]
buttonsForClosingEditpop.forEach((button) => {
  button.addEventListener("click", closeEditFormModal)
})

// Check URL for direct edit comment access
function checkEditCommentFromURL() {
  const urlParams = new URLSearchParams(window.location.search)
  const editCommentId = urlParams.get("editComment")

  if (editCommentId) {
    // Find the comment and trigger edit
    const commentElement = document.querySelector(`[data-comment-id="${editCommentId}"]`)
    if (commentElement) {
      const editBtn = commentElement.querySelector(".edit-comment-btn")
      if (editBtn && editBtn.closest(".comment-owner-actions").style.display !== "none") {
        const commentText = editBtn.getAttribute("data-comment-text")
        const commentImage = editBtn.getAttribute("data-comment-image")
        showEditCommentPopup(editCommentId, commentText, commentImage)
      }
    }
  }
}

// Workflow blocking functionality
function applyCommentWorkflowBlocking() {
  if (!window.workflowTracker) return

  const userCookie = getCookie()
  if (!userCookie) return

  const activeSubmissions = window.workflowTracker.loadActiveSubmissions()
  const hasActiveSubmissions = activeSubmissions.length > 0

  if (hasActiveSubmissions) {
    // Block new comment form
    const commentForm = document.getElementById("commentForm")
    const commentStatus = document.getElementById("commentStatus")
    const commentSubmitBtn = commentForm.querySelector('button[type="submit"]')

    if (commentForm && commentSubmitBtn) {
      commentSubmitBtn.disabled = true
      commentStatus.textContent =
        "Please wait for your previous submission to complete before submitting a new comment."
      commentStatus.className = "text-sm text-yellow-600"
    }

    // Block edit comment form if open
    const editCommentForm = document.getElementById("editCommentForm")
    const editCommentStatus = document.getElementById("editCommentStatus")
    const editSubmitBtn = editCommentForm.querySelector('button[type="submit"]')

    if (editCommentForm && editSubmitBtn) {
      editSubmitBtn.disabled = true
      editCommentStatus.innerHTML =
        '<div class="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">Please wait for your previous submission to complete before editing comments.</div>'
      editCommentStatus.className = "mb-4"
    }

    // Disable edit/delete buttons
    const editBtns = document.querySelectorAll(".edit-comment-btn")
    const deleteBtns = document.querySelectorAll(".delete-comment-btn")

    editBtns.forEach((btn) => (btn.disabled = true))
    deleteBtns.forEach((btn) => (btn.disabled = true))
  }
}

document.addEventListener("DOMContentLoaded", async function () {
  // Initialize comment functionality
  await revealCommentActionsIfRequired()
  checkEditCommentFromURL()
  applyCommentWorkflowBlocking()

  // Apply blocking when workflow tracker updates
  if (window.workflowTracker) {
    window.workflowTracker.onUpdate = applyCommentWorkflowBlocking
  }
})
